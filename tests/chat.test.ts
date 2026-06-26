import { describe, expect, test } from "bun:test";
import { ChatRateLimiterRegistry, parseIngameChatLine, type ChatAuditEvent, type ChatMetrics } from "../src/chat";
import { rebuildRuntimeIndexes, type RuntimeConfig } from "../src/config";

describe("chat parser", () => {
  test("parses authorized vanilla mention", () => {
    const config = fixtureConfig();
    const result = parseIngameChatLine({
      serverId: "survival",
      line: "[12:34:56] [Server thread/INFO]: <Steve> @bot hello",
      config,
      now: fixedNow,
    });

    expect(result).toEqual({
      kind: "mention",
      serverId: "survival",
      playerName: "Steve",
      occurredAt: "2026-06-19T12:34:56.000Z",
      mention: { agentId: "assistant", message: "hello" },
    });
  });

  test("ignores non-chat lines", () => {
    expect(parse("[12:34:58] [Server thread/INFO]: Steve joined the game")).toMatchObject({
      kind: "ignored",
      playerName: "system",
      reason: "not_chat",
    });
  });

  test("strips team decoration before validation and lookup", () => {
    const result = parse("[12:34:56] [Server thread/INFO]: <[VIP]Steve*> @bot build", decoratedConfig());

    expect(result).toMatchObject({ kind: "mention", playerName: "Steve", mention: { agentId: "assistant", message: "build" } });
  });

  test("ignores invalid player names", () => {
    expect(parse("[12:34:56] [Server thread/INFO]: <Steve!> @bot hello")).toMatchObject({
      kind: "ignored",
      reason: "invalid_player",
    });
  });

  test("selects first matching alias", () => {
    const result = parse("[12:34:56] [Server thread/INFO]: <Steve> words @builder first @bot second");

    expect(result).toMatchObject({ kind: "mention", mention: { agentId: "builder", message: "first @bot second" } });
  });

  test("returns help trigger with permitted agents", () => {
    expect(parse("[12:34:57] [Server thread/INFO]: <Steve> !help")).toMatchObject({
      kind: "help_trigger",
      playerName: "Steve",
      permittedAgents: ["assistant", "builder"],
    });
  });

  test("permission lookup is case-insensitive", () => {
    const result = parse("[12:34:56] [Server thread/INFO]: <sTeVe> @bot hello");

    expect(result).toMatchObject({ kind: "mention", playerName: "sTeVe" });
  });

  test("denies unknown player by default and audits without raw message", () => {
    const audit: ChatAuditEvent[] = [];
    const result = parseIngameChatLine({
      serverId: "survival",
      line: "[12:34:56] [Server thread/INFO]: <Alex> @bot secret text",
      config: fixtureConfig(),
      now: fixedNow,
      audit: (event) => audit.push(event),
    });

    expect(result).toMatchObject({ kind: "ignored", reason: "permission" });
    expect(audit).toEqual([
      expect.objectContaining({ actionType: "mention_denied", agentId: "assistant", reason: "permission", target: "<mention redacted>" }),
    ]);
    expect(JSON.stringify(audit)).not.toContain("secret text");
  });

  test("denies agent not allowed for player", () => {
    const result = parse("[12:34:56] [Server thread/INFO]: <Steve> @miner hello", restrictedConfig());

    expect(result).toMatchObject({ kind: "ignored", reason: "permission" });
  });

  test("rate limiter denies after rpm", () => {
    let now = 0;
    const limiter = new ChatRateLimiterRegistry(() => now);
    const config = rateConfig({ rpm: 1, cooldown: 0 });
    const first = parseWithLimiter("[12:34:56] [Server thread/INFO]: <Steve> @bot one", config, limiter, () => now);
    const second = parseWithLimiter("[12:34:57] [Server thread/INFO]: <Steve> @bot two", config, limiter, () => now);
    now = 60_000;
    const third = parseWithLimiter("[12:34:58] [Server thread/INFO]: <Steve> @bot three", config, limiter, () => now);

    expect(first).toMatchObject({ kind: "mention" });
    expect(second).toMatchObject({ kind: "ignored", reason: "rate_limited" });
    expect(third).toMatchObject({ kind: "mention" });
  });

  test("default limiter is shared across parser calls", () => {
    let now = 0;
    const clock = () => now;
    const config = rateConfig({ rpm: 1, cooldown: 0 });
    const first = parseIngameChatLine({ serverId: "survival", line: "[12:34:56] [Server thread/INFO]: <Steve> @bot one", config, now: clock });
    const second = parseIngameChatLine({ serverId: "survival", line: "[12:34:57] [Server thread/INFO]: <Steve> @bot two", config, now: clock });

    expect(first).toMatchObject({ kind: "mention" });
    expect(second).toMatchObject({ kind: "ignored", reason: "rate_limited" });
  });

  test("cooldown denies repeated mention", () => {
    let now = 0;
    const limiter = new ChatRateLimiterRegistry(() => now);
    const config = rateConfig({ rpm: 10, cooldown: 5 });
    const first = parseWithLimiter("[12:34:56] [Server thread/INFO]: <Steve> @bot one", config, limiter, () => now);
    now = 4_000;
    const second = parseWithLimiter("[12:34:57] [Server thread/INFO]: <Steve> @bot two", config, limiter, () => now);
    now = 5_000;
    const third = parseWithLimiter("[12:34:58] [Server thread/INFO]: <Steve> @bot three", config, limiter, () => now);

    expect(first).toMatchObject({ kind: "mention" });
    expect(second).toMatchObject({ kind: "ignored", reason: "rate_limited" });
    expect(third).toMatchObject({ kind: "mention" });
  });

  test("emits parser metrics", () => {
    const events: string[] = [];
    const metrics: ChatMetrics = {
      chatLineParsed: (_serverId, outcome) => events.push(`parsed:${outcome}`),
      mentionAuthorized: (_serverId, agentId) => events.push(`authorized:${agentId}`),
      mentionDenied: (_serverId, agentId, reason) => events.push(`denied:${agentId}:${reason}`),
      rateLimitUtilization: (_serverId, agentId, playerName, ratio) => events.push(`util:${agentId}:${playerName}:${ratio}`),
    };

    parseIngameChatLine({ serverId: "survival", line: "[12:34:56] [Server thread/INFO]: <Steve> @bot hello", config: fixtureConfig(), now: fixedNow, metrics });
    parseIngameChatLine({ serverId: "survival", line: "[12:34:56] [Server thread/INFO]: <Alex> @bot hello", config: fixtureConfig(), now: fixedNow, metrics });

    expect(events).toContain("parsed:mention");
    expect(events).toContain("authorized:assistant");
    expect(events).toContain("denied:assistant:permission");
    expect(events).toContain("parsed:ignored");
  });
});

function parse(line: string, config = fixtureConfig()) {
  return parseIngameChatLine({ serverId: "survival", line, config, indexes: rebuildRuntimeIndexes(config), now: fixedNow });
}

function parseWithLimiter(line: string, config: RuntimeConfig, limiter: ChatRateLimiterRegistry, now: () => number) {
  return parseIngameChatLine({ serverId: "survival", line, config, indexes: rebuildRuntimeIndexes(config), limiter, now });
}

function fixedNow(): number {
  return Date.UTC(2026, 5, 19, 12, 34, 56);
}

function decoratedConfig(): RuntimeConfig {
  const config = fixtureConfig();
  return {
    ...config,
    permissions: { survival: { players: [{ name: "Steve", teamPrefix: "[VIP]", teamSuffix: "*", agents: ["assistant"], inGameAdmin: false }] } },
  };
}

function restrictedConfig(): RuntimeConfig {
  const config = fixtureConfig();
  return { ...config, permissions: { survival: { players: [{ name: "Steve", agents: ["assistant"], inGameAdmin: false }] } } };
}

function rateConfig(rateLimit: { readonly rpm: number; readonly cooldown: number }): RuntimeConfig {
  const config = fixtureConfig();
  return { ...config, agents: { ...config.agents, assistant: { ...config.agents.assistant!, rateLimit } } };
}

function fixtureConfig(): RuntimeConfig {
  return {
    schemaVersion: 1,
    servers: {},
    providers: {},
    agents: {
      assistant: agent("assistant", "bot"),
      builder: agent("builder", "builder"),
      miner: agent("miner", "miner"),
    },
    permissions: { survival: { players: [{ name: "Steve", agents: ["assistant", "builder"], inGameAdmin: false }] } },
    featureFlags: { audioplayer: false },
    telemetry: { enabled: false },
    logging: { level: "info", rotationBytes: 1024 },
    sessionRetention: "30d",
  };
}

function agent(id: string, alias: string) {
  return {
    id,
    name: id,
    alias,
    provider: "openai",
    systemPrompt: "Help players.",
    tools: [],
    timeout: 30_000,
    commandAllowlist: [],
    rateLimit: { rpm: 10, cooldown: 0 },
    ingameMessageWindow: 5,
  };
}
