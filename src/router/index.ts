export const ROUTER_COMPONENT = "operator-router";

export type RuntimeMode = "normal" | "read-only" | "validate-config";

export type OperatorCommand =
  | "start"
  | "stop"
  | "restart"
  | "chat"
  | "send-stdin"
  | "clear-session"
  | "config-edit"
  | "help"
  | "session-list"
  | "session-resume-view"
  | "log-view"
  | "config-view"
  | "navigate"
  | "quit";

export const MUTATING_COMMANDS = new Set<OperatorCommand>([
  "start",
  "stop",
  "restart",
  "chat",
  "send-stdin",
  "clear-session",
  "config-edit",
]);

export const NON_MUTATING_COMMANDS = new Set<OperatorCommand>([
  "help",
  "session-list",
  "session-resume-view",
  "log-view",
  "config-view",
  "navigate",
  "quit",
]);

export interface ParsedCommand {
  readonly command: OperatorCommand;
  readonly args?: unknown;
  readonly idempotencyKey?: string;
}

export interface OperatorError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export type OperatorResponse =
  | { readonly status: 200; readonly body: object }
  | { readonly status: 403 | 404 | 501; readonly body: OperatorError };

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

export interface OperatorRouterOptions {
  readonly runtimeMode: RuntimeMode;
  readonly sessionStore?: {
    list?(): readonly SessionSummary[] | Promise<readonly SessionSummary[]>;
    resume?(sessionId: string): SessionDetail | undefined | Promise<SessionDetail | undefined>;
    clear?(filter: { readonly serverId?: string; readonly agentId?: string }): number | Promise<number>;
  };
  readonly now?: () => number;
}

type Handler = (command: ParsedCommand) => Promise<OperatorResponse>;

export class OperatorRouter {
  readonly dispatchTable: ReadonlyMap<OperatorCommand, Handler>;
  private readonly idempotency: IdempotencyCache;

  constructor(private readonly options: OperatorRouterOptions) {
    this.idempotency = new IdempotencyCache(options.now);
    this.dispatchTable = new Map<OperatorCommand, Handler>([
      ["help", () => this.help()],
      ["session-list", () => this.sessionList()],
      ["session-resume-view", (command) => this.resume(command.args)],
      ["clear-session", (command) => this.clear(command.args)],
      ["start", () => notImplemented("start")],
      ["stop", () => notImplemented("stop")],
      ["restart", () => notImplemented("restart")],
      ["chat", () => notImplemented("chat")],
      ["send-stdin", () => notImplemented("send-stdin")],
      ["config-edit", () => notImplemented("config-edit")],
      ["log-view", async () => ok({})],
      ["config-view", async () => ok({})],
      ["navigate", async () => ok({})],
      ["quit", async () => ok({})],
    ]);
  }

  async route(command: ParsedCommand): Promise<OperatorResponse> {
    const gate = classifyCommand(command.command, this.options.runtimeMode);
    if (!gate.allowed) return readOnlyBlocked(command.command);

    const handler = this.dispatchTable.get(command.command);
    if (handler === undefined) return notImplemented(command.command);

    if (!MUTATING_COMMANDS.has(command.command)) return handler(command);

    return this.idempotency.getOrSet(command, () => handler(command));
  }

  private async help(): Promise<OperatorResponse> {
    return ok({
      commands: Array.from(this.dispatchTable.keys()).map((command) => ({
        name: slashName(command),
        summary: summaryFor(command),
        mutating: MUTATING_COMMANDS.has(command),
      })),
      readOnly: this.options.runtimeMode === "read-only",
    });
  }

  private async sessionList(): Promise<OperatorResponse> {
    return ok({ items: await this.options.sessionStore?.list?.() ?? [] });
  }

  private async resume(args: unknown): Promise<OperatorResponse> {
    const sessionId = readStringArg(args, "sessionId");
    if (sessionId === undefined) return this.sessionList();
    const detail = await this.options.sessionStore?.resume?.(sessionId);
    return detail === undefined
      ? error(404, "SESSION_NOT_FOUND", `No session with id "${sessionId}".`, { sessionId })
      : ok(detail);
  }

  private async clear(args: unknown): Promise<OperatorResponse> {
    const filter = {
      serverId: readStringArg(args, "serverId"),
      agentId: readStringArg(args, "agentId"),
    };
    return ok({ cleared: await this.options.sessionStore?.clear?.(filter) ?? 0 });
  }
}

export function classifyCommand(
  command: OperatorCommand,
  runtimeMode: RuntimeMode,
): { readonly allowed: true } | { readonly allowed: false; readonly reason: "READ_ONLY_BLOCKED" } {
  if (runtimeMode === "read-only" && MUTATING_COMMANDS.has(command)) {
    return { allowed: false, reason: "READ_ONLY_BLOCKED" };
  }
  return { allowed: true };
}

export function parseOperatorCommand(input: string, idempotencyKey?: string): ParsedCommand {
  const [name, ...rest] = input.trim().split(/\s+/);
  const command = slashToCommand(name ?? "");
  return { command, args: parseArgs(command, rest), idempotencyKey };
}

class IdempotencyCache {
  private readonly entries = new Map<string, { readonly expiresAt: number; readonly response: Promise<OperatorResponse> }>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async getOrSet(command: ParsedCommand, create: () => Promise<OperatorResponse>): Promise<OperatorResponse> {
    const now = this.now();
    if (now - this.lastSweep >= 60_000) {
      this.sweep(now);
      this.lastSweep = now;
    }

    const key = await idempotencyCacheKey(command);
    const cached = this.entries.get(key);
    if (cached !== undefined && cached.expiresAt > now) return cached.response;

    const response = create();
    this.entries.set(key, { response, expiresAt: now + 5_000 });
    return response;
  }

  private sweep(now: number): void {
    for (const [key, value] of this.entries) {
      if (value.expiresAt <= now) this.entries.delete(key);
    }
  }
}

async function idempotencyCacheKey(command: ParsedCommand): Promise<string> {
  if (command.idempotencyKey !== undefined) return command.idempotencyKey;
  const encoded = new TextEncoder().encode(JSON.stringify([command.command, command.args ?? null]));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseArgs(command: OperatorCommand, rest: readonly string[]): unknown {
  if (["start", "stop", "restart"].includes(command)) return { serverId: rest[0] };
  if (command === "chat") return { agentId: rest[0], message: rest.slice(1).join(" ") };
  if (command === "session-resume-view") return { sessionId: rest[0] };
  if (command === "clear-session") return { serverId: rest[0], agentId: rest[1] };
  return {};
}

function slashToCommand(name: string): OperatorCommand {
  switch (name) {
    case "/start": return "start";
    case "/stop": return "stop";
    case "/restart": return "restart";
    case "/chat": return "chat";
    case "/session": return "session-list";
    case "/resume": return "session-resume-view";
    case "/clear": return "clear-session";
    case "/help": return "help";
    default: throw new Error(`unknown operator command: ${name}`);
  }
}

function slashName(command: OperatorCommand): string {
  const names: Record<OperatorCommand, string> = {
    "start": "/start",
    "stop": "/stop",
    "restart": "/restart",
    "chat": "/chat",
    "send-stdin": "send-stdin",
    "clear-session": "/clear",
    "config-edit": "config-edit",
    "help": "/help",
    "session-list": "/session",
    "session-resume-view": "/resume",
    "log-view": "log-view",
    "config-view": "config-view",
    "navigate": "navigate",
    "quit": "quit",
  };
  return names[command];
}

function summaryFor(command: OperatorCommand): string {
  const summaries: Record<OperatorCommand, string> = {
    "start": "Start a server.",
    "stop": "Stop a server.",
    "restart": "Restart a server.",
    "chat": "Chat with an agent.",
    "send-stdin": "Send raw server stdin.",
    "clear-session": "Drop in-memory session handles.",
    "config-edit": "Save configuration changes.",
    "help": "List commands.",
    "session-list": "List sessions.",
    "session-resume-view": "View session history.",
    "log-view": "View logs.",
    "config-view": "View configuration.",
    "navigate": "Move around the TUI.",
    "quit": "Exit the TUI.",
  };
  return summaries[command];
}

function readStringArg(args: unknown, key: string): string | undefined {
  if (args === null || typeof args !== "object" || !(key in args)) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function ok(body: object): OperatorResponse {
  return { status: 200, body };
}

function error(
  status: 403 | 404 | 501,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): OperatorResponse {
  return { status, body: details === undefined ? { code, message } : { code, message, details } };
}

function readOnlyBlocked(command: OperatorCommand): OperatorResponse {
  return error(403, "READ_ONLY_BLOCKED", "This command is blocked in --read-only mode.", { command });
}

async function notImplemented(command: OperatorCommand): Promise<OperatorResponse> {
  // ponytail: later phases own these handlers; PHASE-003 only proves the gate cannot be bypassed.
  return error(501, "NOT_IMPLEMENTED", `Command "${slashName(command)}" is not implemented yet.`, { command });
}
