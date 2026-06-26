import { rebuildRuntimeIndexes, type RuntimeIndexes } from "../config";
import type { AgentConfig, PlayerConfig, RuntimeConfig } from "../config";

export const CHAT_COMPONENT = "chat-parser";

export type IngameChatParseResult =
  | {
    readonly kind: "mention";
    readonly serverId: string;
    readonly playerName: string;
    readonly occurredAt: string;
    readonly mention: { readonly agentId: string; readonly message: string };
  }
  | {
    readonly kind: "help_trigger";
    readonly serverId: string;
    readonly playerName: string;
    readonly occurredAt: string;
    readonly permittedAgents: readonly string[];
  }
  | {
    readonly kind: "ignored";
    readonly serverId: string;
    readonly playerName: string;
    readonly occurredAt: string;
    readonly reason: ChatIgnoredReason;
  };

export type ChatIgnoredReason = "not_chat" | "invalid_player" | "no_alias" | "permission" | "rate_limited";
export type ChatDenyReason = "permission" | "rate_limited";

export interface ChatAuditEvent {
  readonly actionType: "mention_authorized" | "mention_denied";
  readonly serverId: string;
  readonly agentId: string;
  readonly playerName: string;
  readonly outcome: "ok" | "blocked";
  readonly target: "<mention redacted>";
  readonly argumentsDigest: string;
  readonly reason?: ChatDenyReason;
}

export interface ChatMetrics {
  chatLineParsed?(serverId: string, outcome: "mention" | "help" | "ignored"): void;
  mentionAuthorized?(serverId: string, agentId: string): void;
  mentionDenied?(serverId: string, agentId: string, reason: ChatDenyReason): void;
  rateLimitUtilization?(serverId: string, agentId: string, playerName: string, ratio: number): void;
}

export interface ParseIngameChatLineOptions {
  readonly serverId: string;
  readonly line: string;
  readonly config: RuntimeConfig;
  readonly indexes?: RuntimeIndexes;
  readonly limiter?: ChatRateLimiterRegistry;
  readonly now?: () => number;
  readonly audit?: (event: ChatAuditEvent) => void;
  readonly metrics?: ChatMetrics;
}

const CHAT_LINE_REGEX = /^\[(?<time>\d{2}:\d{2}:\d{2})\] \[Server thread\/INFO\]: <(?<player>[^>]+)> (?<message>.*)$/;
const PLAYER_NAME_REGEX = /^[a-zA-Z0-9_]{1,16}$/;
const DEFAULT_PLAYER_NAME = "system";
const DEFAULT_LIMITERS = new WeakMap<() => number, ChatRateLimiterRegistry>();

export function parseIngameChatLine(options: ParseIngameChatLineOptions): IngameChatParseResult {
  const now = options.now ?? Date.now;
  const occurredAt = new Date(now()).toISOString();
  const match = CHAT_LINE_REGEX.exec(options.line);
  if (match?.groups === undefined) return ignored(options, DEFAULT_PLAYER_NAME, occurredAt, "not_chat");
  const rawPlayer = match.groups.player;
  const message = match.groups.message;
  if (rawPlayer === undefined || message === undefined) return ignored(options, DEFAULT_PLAYER_NAME, occurredAt, "not_chat");

  const playerName = stripDecoration(rawPlayer, options.config.permissions[options.serverId]?.players ?? []);
  if (!PLAYER_NAME_REGEX.test(playerName)) return ignored(options, DEFAULT_PLAYER_NAME, occurredAt, "invalid_player");

  const indexes = options.indexes ?? rebuildRuntimeIndexes(options.config);
  const player = indexes.permissions.get(options.serverId)?.get(playerName.toLowerCase());
  if (message.trim() === "!help") return help(options, playerName, occurredAt, permittedAgents(player, options.config));

  const mention = findFirstMention(message, Object.values(options.config.agents));
  if (mention === undefined) return ignored(options, playerName, occurredAt, "no_alias");

  if (player === undefined || !player.agents.includes(mention.agent.id)) {
    deny(options, mention.agent.id, playerName, "permission");
    return ignored(options, playerName, occurredAt, "permission");
  }

  const limiter = options.limiter ?? defaultLimiter(now);
  const decision = limiter.acquire(options.serverId, mention.agent, playerName);
  options.metrics?.rateLimitUtilization?.(options.serverId, mention.agent.id, playerName, decision.utilization);
  if (!decision.allowed) {
    deny(options, mention.agent.id, playerName, "rate_limited");
    return ignored(options, playerName, occurredAt, "rate_limited");
  }

  const result = {
    kind: "mention" as const,
    serverId: options.serverId,
    playerName,
    occurredAt,
    mention: { agentId: mention.agent.id, message: message.slice(mention.index + mention.token.length).trimStart() },
  };
  options.metrics?.chatLineParsed?.(options.serverId, "mention");
  options.metrics?.mentionAuthorized?.(options.serverId, mention.agent.id);
  options.audit?.({
    actionType: "mention_authorized",
    serverId: options.serverId,
    agentId: mention.agent.id,
    playerName,
    outcome: "ok",
    target: "<mention redacted>",
    argumentsDigest: fnv1a(`${options.serverId}:${mention.agent.id}:${playerName}:${message}`),
  });
  return result;
}

function defaultLimiter(now: () => number): ChatRateLimiterRegistry {
  const existing = DEFAULT_LIMITERS.get(now);
  if (existing !== undefined) return existing;
  const next = new ChatRateLimiterRegistry(now);
  DEFAULT_LIMITERS.set(now, next);
  return next;
}

export class ChatRateLimiterRegistry {
  private readonly buckets = new Map<string, SlidingWindowBucket>();
  private readonly cooldownUntil = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  acquire(serverId: string, agent: AgentConfig, playerName: string): { readonly allowed: boolean; readonly utilization: number } {
    const key = `${serverId}:${agent.id}:${playerName.toLowerCase()}`;
    const now = this.now();
    this.pruneIdle(key, now);
    if ((this.cooldownUntil.get(key) ?? 0) > now) return { allowed: false, utilization: this.utilization(key) };

    const bucket = this.bucket(key, agent.rateLimit.rpm);
    const allowed = bucket.acquire(now);
    if (allowed && agent.rateLimit.cooldown > 0) this.cooldownUntil.set(key, now + agent.rateLimit.cooldown * 1000);
    return { allowed, utilization: bucket.utilization(now) };
  }

  private bucket(key: string, rpm: number): SlidingWindowBucket {
    const existing = this.buckets.get(key);
    if (existing !== undefined && existing.limit === rpm) return existing;
    const next = new SlidingWindowBucket(rpm);
    this.buckets.set(key, next);
    return next;
  }

  private utilization(key: string): number {
    return this.buckets.get(key)?.utilization(this.now()) ?? 0;
  }

  private pruneIdle(key: string, now: number): void {
    const bucket = this.buckets.get(key);
    const cooldownExpired = (this.cooldownUntil.get(key) ?? 0) <= now;
    if (bucket?.isEmpty(now) === true && cooldownExpired) {
      this.buckets.delete(key);
      this.cooldownUntil.delete(key);
    }
  }
}

class SlidingWindowBucket {
  private readonly hits: number[] = [];

  constructor(readonly limit: number) {}

  acquire(now: number): boolean {
    this.prune(now);
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }

  utilization(now: number): number {
    this.prune(now);
    return this.limit <= 0 ? 1 : Math.min(1, this.hits.length / this.limit);
  }

  isEmpty(now: number): boolean {
    this.prune(now);
    return this.hits.length === 0;
  }

  private prune(now: number): void {
    while (this.hits[0] !== undefined && now - this.hits[0] >= 60_000) this.hits.shift();
  }
}

function stripDecoration(rawPlayer: string, players: readonly PlayerConfig[]): string {
  for (const player of players) {
    let candidate = rawPlayer;
    if (player.teamPrefix !== undefined && candidate.startsWith(player.teamPrefix)) candidate = candidate.slice(player.teamPrefix.length);
    if (player.teamSuffix !== undefined && candidate.endsWith(player.teamSuffix)) candidate = candidate.slice(0, -player.teamSuffix.length);
    if (candidate.toLowerCase() === player.name.toLowerCase()) return candidate;
  }
  return rawPlayer;
}

function findFirstMention(message: string, agents: readonly AgentConfig[]): { readonly agent: AgentConfig; readonly index: number; readonly token: string } | undefined {
  let selected: { readonly agent: AgentConfig; readonly index: number; readonly token: string } | undefined;
  for (const agent of agents) {
    const token = `@${agent.alias}`;
    const index = mentionIndex(message, token);
    if (index === -1) continue;
    if (selected === undefined || index < selected.index) selected = { agent, index, token };
  }
  return selected;
}

function mentionIndex(message: string, token: string): number {
  let from = 0;
  while (from < message.length) {
    const index = message.indexOf(token, from);
    if (index === -1) return -1;
    const next = message[index + token.length];
    if (next === undefined || !/[a-zA-Z0-9_-]/.test(next)) return index;
    from = index + token.length;
  }
  return -1;
}

function permittedAgents(player: PlayerConfig | undefined, config: RuntimeConfig): readonly string[] {
  if (player === undefined) return [];
  return player.agents.filter((agentId) => config.agents[agentId] !== undefined);
}

function help(options: ParseIngameChatLineOptions, playerName: string, occurredAt: string, permitted: readonly string[]): IngameChatParseResult {
  options.metrics?.chatLineParsed?.(options.serverId, "help");
  return { kind: "help_trigger", serverId: options.serverId, playerName, occurredAt, permittedAgents: permitted };
}

function ignored(options: ParseIngameChatLineOptions, playerName: string, occurredAt: string, reason: ChatIgnoredReason): IngameChatParseResult {
  options.metrics?.chatLineParsed?.(options.serverId, "ignored");
  return { kind: "ignored", serverId: options.serverId, playerName, occurredAt, reason };
}

function deny(options: ParseIngameChatLineOptions, agentId: string, playerName: string, reason: ChatDenyReason): void {
  options.metrics?.mentionDenied?.(options.serverId, agentId, reason);
  options.audit?.({
    actionType: "mention_denied",
    serverId: options.serverId,
    agentId,
    playerName,
    outcome: "blocked",
    target: "<mention redacted>",
    argumentsDigest: fnv1a(`${options.serverId}:${agentId}:${playerName}:${reason}`),
    reason,
  });
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
