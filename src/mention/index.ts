import type { AgentRunTerminalState } from "../agent";
import { ChatRateLimiterRegistry, parseIngameChatLine, type ChatAuditEvent } from "../chat";
import { rebuildRuntimeIndexes, type RuntimeConfig } from "../config";
import type { LogBufferSnapshot } from "../log";

export const MENTION_COMPONENT = "mention-router";
export const TELLRAW_CHUNK_LIMIT = 200;
export const TELLRAW_PACE_MS = 500;

export type IngameDeliveryResult =
  | { readonly ok: true; readonly chunksDelivered: number }
  | { readonly ok: false; readonly code: "OFFLINE_FAIL" | "CHUNK_SPLIT_FAILED"; readonly chunksDelivered: number };

export interface MentionAuditEvent {
  readonly actionType: ChatAuditEvent["actionType"] | "tellraw_sent" | "say_fallback" | "tellraw_skipped";
  readonly serverId: string;
  readonly agentId: string;
  readonly playerName: string;
  readonly outcome: "ok" | "blocked" | "failed";
  readonly target: string;
  readonly detail?: string;
}

export interface MentionRouterOptions {
  readonly config: RuntimeConfig;
  readonly agentExecutor: {
    chat(input: { readonly serverId: string; readonly agentId: string; readonly message: string; readonly playerName: string }): Promise<{ readonly runId: string }>;
    runState(runId: string): AgentRunTerminalState | undefined;
  };
  readonly sendCommand: (serverId: string, line: string) => Promise<{ readonly ok: boolean; readonly code?: string }>;
  readonly logSnapshot: (serverId: string, limit?: number) => LogBufferSnapshot;
  readonly audit?: (event: MentionAuditEvent) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollMs?: number;
}

export class MentionRouter {
  private readonly indexes;
  private readonly limiter;

  constructor(private readonly options: MentionRouterOptions) {
    this.indexes = rebuildRuntimeIndexes(options.config);
    this.limiter = new ChatRateLimiterRegistry(options.now);
  }

  handleLine(serverId: string, line: string): void {
    const result = parseIngameChatLine({
      serverId,
      line,
      config: this.options.config,
      indexes: this.indexes,
      limiter: this.limiter,
      now: this.options.now,
      audit: (event) => this.options.audit?.({ ...event, target: event.target }),
    });

    if (result.kind === "mention") {
      void this.handleMention(line, result).catch(() => {});
      return;
    }
    if (result.kind === "help_trigger" && result.permittedAgents.length > 0) {
      void this.options.sendCommand(result.serverId, tellrawCommand(`Available agents: ${result.permittedAgents.map((id) => `@${this.options.config.agents[id]?.alias ?? id}`).join(", ")}`)).catch(() => {});
    }
  }

  private async handleMention(triggerLine: string, result: Extract<ReturnType<typeof parseIngameChatLine>, { readonly kind: "mention" }>): Promise<void> {
    const agent = this.options.config.agents[result.mention.agentId];
    if (agent === undefined) return;
    const context = recentContext(this.options.logSnapshot(result.serverId, agent.ingameMessageWindow + 1), triggerLine, agent.ingameMessageWindow);
    const message = context.length === 0 ? result.mention.message : `Recent server context:\n${context.join("\n")}\n\nPlayer message:\n${result.mention.message}`;
    const run = await this.options.agentExecutor.chat({ serverId: result.serverId, agentId: result.mention.agentId, message, playerName: result.playerName });
    const state = await waitForRun(run.runId, this.options.agentExecutor.runState.bind(this.options.agentExecutor), this.options.sleep ?? sleep, this.options.pollMs ?? 100);
    if (state.status !== "completed") return;
    await deliverInGame({
      serverId: result.serverId,
      agentId: agent.id,
      agentAlias: agent.alias,
      playerName: result.playerName,
      response: state.output,
      sendCommand: this.options.sendCommand,
      audit: this.options.audit,
      sleep: this.options.sleep,
    });
  }
}

export function stripFormatting(text: string): string {
  return text.replace(/[§&][0-9A-FK-ORa-fk-or]/g, "");
}

export function splitIntoChunks(text: string, limit = TELLRAW_CHUNK_LIMIT): readonly string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > limit) {
    const index = bestSplitIndex(rest, limit);
    if (index <= 0) return [];
    chunks.push(rest.slice(0, index).trim());
    rest = rest.slice(index).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

export async function deliverInGame(options: {
  readonly serverId: string;
  readonly agentId: string;
  readonly agentAlias: string;
  readonly playerName: string;
  readonly response: string;
  readonly sendCommand: (serverId: string, line: string) => Promise<{ readonly ok: boolean; readonly code?: string }>;
  readonly audit?: (event: MentionAuditEvent) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<IngameDeliveryResult> {
  const chunks = splitIntoChunks(stripFormatting(options.response));
  if (chunks.length === 0) {
    options.audit?.(audit(options, "tellraw_skipped", "failed", "CHUNK_SPLIT_FAILED"));
    return { ok: false, code: "CHUNK_SPLIT_FAILED", chunksDelivered: 0 };
  }

  let delivered = 0;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index] ?? "";
    const sent = await options.sendCommand(options.serverId, tellrawCommand(chunk, options.agentAlias, options.playerName));
    if (sent.ok) {
      delivered++;
      options.audit?.(audit(options, "tellraw_sent", "ok", `chunk ${index + 1}/${chunks.length}`));
    } else if (sent.code === "NOT_RUNNING") {
      options.audit?.(audit(options, "tellraw_skipped", "failed", "OFFLINE_FAIL"));
      return { ok: false, code: "OFFLINE_FAIL", chunksDelivered: delivered };
    } else {
      const fallback = await options.sendCommand(options.serverId, `/say [${options.agentAlias}] ${chunk}`);
      if (!fallback.ok) return { ok: false, code: "OFFLINE_FAIL", chunksDelivered: delivered };
      delivered++;
      options.audit?.(audit(options, "say_fallback", "ok", `chunk ${index + 1}/${chunks.length}`));
    }
    if (index < chunks.length - 1) await (options.sleep ?? sleep)(TELLRAW_PACE_MS);
  }
  return { ok: true, chunksDelivered: delivered };
}

export function tellrawCommand(text: string, agentAlias = "agent", playerName = "system"): string {
  return `/tellraw @a ${JSON.stringify([
    "",
    {
      hover_event: {
        action: "show_text",
        value: [
          "",
          { color: "gray", text: "Agent: " },
          { color: "light_purple", text: agentAlias },
          {},
          { color: "gray", text: "Player:" },
          { color: "aqua", text: ` ${playerName}` },
          {},
          { color: "gray", text: "Status:" },
          { color: "white", text: " <" },
          { color: "dark_green", text: "Success" },
          { color: "white", text: ">" },
        ],
      },
      text: "",
      extra: [{ color: "white", text: "[" }, { color: "aqua", text: agentAlias }, { color: "white", text: "]" }],
    },
    { color: "gray", text: ` ${text}` },
  ])}`;
}

function recentContext(snapshot: LogBufferSnapshot, triggerLine: string, limit: number): readonly string[] {
  return snapshot.lines.map((line) => line.text).filter((line) => line !== triggerLine).slice(-limit);
}

async function waitForRun(runId: string, runState: (runId: string) => AgentRunTerminalState | undefined, sleeper: (ms: number) => Promise<void>, pollMs: number): Promise<AgentRunTerminalState> {
  while (true) {
    const state = runState(runId);
    if (state !== undefined && state.status !== "running") return state;
    await sleeper(pollMs);
  }
}

function bestSplitIndex(text: string, limit: number): number {
  for (const pattern of [/([.!?])\s+/g, /([,;:])\s+/g, /\s+/g]) {
    let selected = -1;
    for (const match of text.slice(0, limit + 1).matchAll(pattern)) selected = (match.index ?? 0) + match[0].length;
    if (selected > 0) return selected;
  }
  return limit;
}

function audit(options: { readonly serverId: string; readonly agentId: string; readonly playerName: string }, actionType: MentionAuditEvent["actionType"], outcome: "ok" | "failed", detail: string): MentionAuditEvent {
  return { actionType, serverId: options.serverId, agentId: options.agentId, playerName: options.playerName, outcome, target: "<ingame response>", detail };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
