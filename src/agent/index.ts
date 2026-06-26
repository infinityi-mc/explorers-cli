import { defineAgent, type AgentDefinition } from "@infinityi/engine-lib/agent";
import {
  BudgetExceededError,
  ContextWindowError,
  MaxHandoffsExceededError,
  MaxStepsExceededError,
  ProviderError,
} from "@infinityi/engine-lib/errors";
import { runAgent, type RunEvent, type RunHandle } from "@infinityi/engine-lib/execution";
import type { Message, TextPart } from "@infinityi/engine-lib/messages";
import {
  createAnthropic,
  createOpenAI,
  createOpenAICompatible,
  type Provider,
} from "@infinityi/engine-lib/providers";
import { createSession, InMemorySessionStore, type Session, type SessionStore } from "@infinityi/engine-lib/session";
import type { AgentConfig, RuntimeConfig } from "../config";

export const AGENT_COMPONENT = "agent-executor";

export interface AgentRunResponse {
  readonly runId: string;
  readonly agentId: string;
  readonly stream: true;
  readonly completed: string;
}

export type AgentRunTerminalState =
  | { readonly status: "running" }
  | { readonly status: "completed"; readonly output: string }
  | { readonly status: "failed"; readonly error: AgentExecutorError };

export interface SessionSummary {
  readonly sessionId: string;
  readonly serverId: string;
  readonly agentId: string;
  readonly lastMessageAt: string;
  readonly messageCount: number;
}

export interface SessionDetail {
  readonly sessionId: string;
  readonly serverId: string;
  readonly agentId: string;
  readonly messages: readonly {
    readonly role: "user" | "assistant" | "system" | "tool";
    readonly content: string;
    readonly timestamp: string;
    readonly playerContext?: { readonly playerName: string };
  }[];
}

export interface AgentExecutorOptions {
  readonly config: RuntimeConfig;
  readonly sessionStore?: SessionStore;
  readonly providers?: Readonly<Record<string, Provider>>;
  readonly now?: () => number;
}

export type AgentExecutorErrorCode =
  | "AGENT_NOT_FOUND"
  | "SERVER_NOT_FOUND"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_RATE_LIMITED"
  | "CONTEXT_WINDOW_EXCEEDED"
  | "MAX_STEPS_EXCEEDED"
  | "MAX_HANDOFFS_EXCEEDED"
  | "BUDGET_EXCEEDED"
  | "INTERNAL_ERROR";

export class AgentExecutorError extends Error {
  constructor(
    readonly code: AgentExecutorErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentExecutorError";
  }
}

export class AgentExecutor {
  private readonly agents = new Map<string, AgentDefinition>();
  private readonly handles = new Map<string, RunHandle>();
  private readonly runs = new Map<string, AgentRunTerminalState>();
  private readonly sessions: SharedSessionManager;
  private readonly providers: Readonly<Record<string, Provider>>;

  constructor(private readonly options: AgentExecutorOptions) {
    this.providers = options.providers ?? buildProviderRegistry(options.config);
    this.sessions = new SharedSessionManager(options.sessionStore ?? new InMemorySessionStore(), options.now);
    for (const agent of Object.values(options.config.agents)) this.agents.set(agent.id, this.define(agent));
  }

  async chat(input: { readonly serverId?: string; readonly agentId: string; readonly message: string }): Promise<AgentRunResponse> {
    const configAgent = this.options.config.agents[input.agentId];
    const agent = this.agents.get(input.agentId);
    if (configAgent === undefined || agent === undefined) {
      throw new AgentExecutorError("AGENT_NOT_FOUND", `No agent named "${input.agentId}" is configured.`, { agentId: input.agentId });
    }
    if (input.serverId !== undefined && this.options.config.servers[input.serverId] === undefined) {
      throw new AgentExecutorError("SERVER_NOT_FOUND", `No server named "${input.serverId}" is configured.`, { serverId: input.serverId });
    }

    const session = input.serverId === undefined
      ? createSession()
      : await this.sessions.active(input.serverId, input.agentId, agent.provider.name, agent.provider.defaultModel);

    const runId = `run_${crypto.randomUUID()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), configAgent.timeout * 1_000);
    const partial: string[] = [];
    const handle = runAgent(agent, {
      runId,
      input: userMessage(input.message),
      session,
      stream: true,
      maxSteps: 16,
      maxHandoffs: 8,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "token") partial.push(event.delta);
      },
    });
    this.handles.set(runId, handle);
    this.runs.set(runId, { status: "running" });
    void this.finalizeRun(runId, handle, session, partial, timeout);
    return { runId, agentId: input.agentId, stream: true, completed: `run://${runId}/completed` };
  }

  runHandle(runId: string): RunHandle | undefined {
    return this.handles.get(runId);
  }

  runState(runId: string): AgentRunTerminalState | undefined {
    return this.runs.get(runId);
  }

  async list(): Promise<readonly SessionSummary[]> {
    return this.sessions.list();
  }

  async resume(sessionId: string): Promise<SessionDetail | undefined> {
    return this.sessions.resume(sessionId);
  }

  clear(filter: { readonly serverId?: string; readonly agentId?: string }): number {
    return this.sessions.clear(filter);
  }

  private define(agent: AgentConfig): AgentDefinition {
    const provider = this.providers[agent.provider];
    if (provider === undefined) throw new AgentExecutorError("INTERNAL_ERROR", `Provider "${agent.provider}" is not configured.`, { provider: agent.provider });
    return defineAgent({ name: agent.id, provider, instructions: agent.systemPrompt, tools: [] });
  }

  private async finalizeRun(runId: string, handle: RunHandle, session: Session, partial: readonly string[], timeout: ReturnType<typeof setTimeout>): Promise<void> {
    try {
      for await (const _event of handle) {}
      const result = await handle.completed;
      this.runs.set(runId, { status: "completed", output: result.output });
    } catch (error) {
      if (isAbortError(error) && partial.length > 0) await session.append([assistantMessage(partial.join(""))]);
      this.runs.set(runId, { status: "failed", error: mapAgentExecutorError(error) });
    } finally {
      clearTimeout(timeout);
      this.handles.delete(runId);
    }
  }
}

export function mapAgentExecutorError(error: unknown): AgentExecutorError {
  if (error instanceof AgentExecutorError) return error;
  if (isAbortError(error)) return new AgentExecutorError("PROVIDER_TIMEOUT", "LLM provider did not respond before timeout.");
  if (error instanceof ProviderError) {
    if (error.status === 429) return new AgentExecutorError("PROVIDER_RATE_LIMITED", "LLM provider rate-limited the request.");
    return new AgentExecutorError("PROVIDER_UNAVAILABLE", "LLM provider is currently unavailable.");
  }
  if (error instanceof ContextWindowError) return new AgentExecutorError("CONTEXT_WINDOW_EXCEEDED", error.message);
  if (error instanceof MaxStepsExceededError) return new AgentExecutorError("MAX_STEPS_EXCEEDED", error.message);
  if (error instanceof MaxHandoffsExceededError) return new AgentExecutorError("MAX_HANDOFFS_EXCEEDED", error.message);
  if (error instanceof BudgetExceededError) return new AgentExecutorError("BUDGET_EXCEEDED", error.message);
  return new AgentExecutorError("INTERNAL_ERROR", "An unexpected error occurred.");
}

class SharedSessionManager {
  private readonly cache = new Map<string, Session>();

  constructor(private readonly store: SessionStore, private readonly now: () => number = Date.now) {}

  async active(serverId: string, agentId: string, provider: string, model: string): Promise<Session> {
    const prefix = sessionPrefix(serverId, agentId);
    const cached = firstCached(this.cache, prefix);
    if (cached !== undefined) return cached;
    const page = await this.store.list({ prefix, tenantId: serverId, limit: 1, order: "recent" });
    const id = page.sessions[0]?.id ?? `${prefix}${this.now()}-${randomSuffix()}`;
    return this.cacheSession(createSession({ id, store: this.store, tenantId: serverId, expectedProvider: provider, expectedModel: model }));
  }

  async list(): Promise<readonly SessionSummary[]> {
    const page = await this.store.list({ limit: 200, order: "recent" });
    return page.sessions.map((session) => {
      const parsed = parseSessionId(session.id);
      return {
        sessionId: session.id,
        serverId: parsed.serverId,
        agentId: parsed.agentId,
        lastMessageAt: session.updatedAt ?? session.createdAt ?? new Date(this.now()).toISOString(),
        messageCount: session.messageCount ?? 0,
      };
    });
  }

  async resume(sessionId: string): Promise<SessionDetail | undefined> {
    const state = await this.store.load(sessionId);
    if (state === undefined) return undefined;
    const page = await this.store.list({ prefix: sessionId, limit: 1, order: "id" });
    const timestamp = page.sessions.find((session) => session.id === sessionId)?.updatedAt ?? new Date(this.now()).toISOString();
    const parsed = parseSessionId(sessionId);
    return { sessionId, serverId: parsed.serverId, agentId: parsed.agentId, messages: state.messages.map((message) => sessionMessage(message, timestamp)) };
  }

  clear(filter: { readonly serverId?: string; readonly agentId?: string }): number {
    let cleared = 0;
    for (const id of Array.from(this.cache.keys())) {
      const parsed = parseSessionId(id);
      if (filter.serverId !== undefined && parsed.serverId !== filter.serverId) continue;
      if (filter.agentId !== undefined && parsed.agentId !== filter.agentId) continue;
      this.cache.delete(id);
      cleared++;
    }
    return cleared;
  }

  private cacheSession(session: Session): Session {
    this.cache.set(session.id, session);
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string);
    return session;
  }
}

function buildProviderRegistry(config: RuntimeConfig): Record<string, Provider> {
  const providers: Record<string, Provider> = {};
  for (const provider of Object.values(config.providers)) {
    providers[provider.name] = provider.type === "openai"
      ? createOpenAI({ apiKey: provider.apiKey, model: provider.model, ...(provider.baseUrl !== undefined ? { baseUrl: provider.baseUrl } : {}) })
      : provider.type === "anthropic"
        ? createAnthropic({ apiKey: provider.apiKey, model: provider.model })
        : createOpenAICompatible({ apiKey: provider.apiKey, baseUrl: provider.baseUrl ?? "http://localhost/v1", model: provider.model, name: provider.name });
  }
  return providers;
}

function userMessage(text: string): Message {
  return { role: "user", content: [{ type: "text", text }], metadata: { playerContext: { playerName: "operator" } } };
}

function assistantMessage(text: string): Message {
  return { role: "assistant", content: [{ type: "text", text }] };
}

function sessionMessage(message: Message, timestamp: string): SessionDetail["messages"][number] {
  const playerName = playerContext(message.metadata)?.playerName;
  return {
    role: message.role,
    content: message.content.filter((part): part is TextPart => part.type === "text").map((part) => part.text).join(""),
    timestamp,
    ...(playerName !== undefined ? { playerContext: { playerName } } : {}),
  };
}

function playerContext(metadata: Record<string, unknown> | undefined): { readonly playerName?: string } | undefined {
  const value = metadata?.playerContext;
  return typeof value === "object" && value !== null && "playerName" in value && typeof value.playerName === "string" ? { playerName: value.playerName } : undefined;
}

function firstCached(cache: ReadonlyMap<string, Session>, prefix: string): Session | undefined {
  for (const [id, session] of cache) if (id.startsWith(prefix)) return session;
  return undefined;
}

function sessionPrefix(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}:`;
}

function parseSessionId(sessionId: string): { readonly serverId: string; readonly agentId: string } {
  const [serverId = "offline", agentId = "unknown"] = sessionId.split(":");
  return { serverId, agentId };
}

function randomSuffix(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 6).toLowerCase();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "CancelledError");
}

export type { RunEvent, RunHandle };
