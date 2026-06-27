import { describe, expect, test } from "bun:test";
import { deliverInGame, MentionRouter, splitIntoChunks, stripFormatting, tellrawCommand } from "../src/mention";
import type { AgentRunTerminalState } from "../src/agent";
import type { RuntimeConfig } from "../src/config";
import type { LogBufferSnapshot } from "../src/log";

describe("mention router", () => {
  test("strips Minecraft formatting", () => {
    expect(stripFormatting("§aGreen &cRed normal")).toBe("Green Red normal");
  });

  test("splits response chunks at readable boundaries then hard boundary", () => {
    expect(splitIntoChunks("One sentence. Two sentence.", 16)).toEqual(["One sentence.", "Two sentence."]);
    expect(splitIntoChunks("alpha,beta,gamma", 11)).toEqual(["alpha,beta,", "gamma"]);
    expect(splitIntoChunks("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  test("formats tellraw as escaped JSON command", () => {
    const command = tellrawCommand("quote \" ok", "bot", "Steve");
    expect(command.startsWith("/tellraw @a ")).toBe(true);
    expect(JSON.parse(command.slice("/tellraw @a ".length)).at(-1).text).toBe(" quote \" ok");
  });

  test("delivers tellraw chunks with pacing", async () => {
    const commands: string[] = [];
    const sleeps: number[] = [];
    const result = await deliverInGame({
      serverId: "survival",
      agentId: "assistant",
      agentAlias: "bot",
      playerName: "Steve",
      response: `${"x".repeat(200)} ${"y".repeat(10)}`,
      sendCommand: async (_serverId, line) => {
        commands.push(line);
        return { ok: true };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result).toEqual({ ok: true, chunksDelivered: 2 });
    expect(commands).toHaveLength(2);
    expect(sleeps).toEqual([500]);
  });

  test("falls back to say when tellraw write fails", async () => {
    const commands: string[] = [];
    const result = await deliverInGame({
      serverId: "survival",
      agentId: "assistant",
      agentAlias: "bot",
      playerName: "Steve",
      response: "hello",
      sendCommand: async (_serverId, line) => {
        commands.push(line);
        return { ok: commands.length > 1 };
      },
      sleep: async () => {},
    });

    expect(result).toEqual({ ok: true, chunksDelivered: 1 });
    expect(commands[1]).toBe("/say [bot] hello");
  });

  test("returns offline failure without fallback when server stopped", async () => {
    const result = await deliverInGame({
      serverId: "survival",
      agentId: "assistant",
      agentAlias: "bot",
      playerName: "Steve",
      response: "hello",
      sendCommand: async () => ({ ok: false, code: "NOT_RUNNING" }),
      sleep: async () => {},
    });

    expect(result).toEqual({ ok: false, code: "OFFLINE_FAIL", chunksDelivered: 0 });
  });

  test("authorized mention runs agent with preceding context and writes tellraw", async () => {
    const commands: string[] = [];
    const messages: string[] = [];
    const router = new MentionRouter({
      config: fixtureConfig(),
      agentExecutor: {
        async chat(input) {
          expect(input.playerName).toBe("Steve");
          messages.push(input.message);
          return { runId: "run_1" };
        },
        runState: () => ({ status: "completed", output: "hi Steve" } satisfies AgentRunTerminalState),
      },
      sendCommand: async (_serverId, line) => {
        commands.push(line);
        return { ok: true };
      },
      logSnapshot: () => snapshot(["[12:00:00] [Server thread/INFO]: <Alex> context", "[12:00:01] [Server thread/INFO]: <Steve> @bot hello"]),
      sleep: async () => {},
      pollMs: 1,
    });

    router.handleLine("survival", "[12:00:01] [Server thread/INFO]: <Steve> @bot hello");
    await eventually(() => commands.length === 1);

    expect(messages[0]).toContain("<Alex> context");
    expect(messages[0]).not.toContain("@bot hello");
    expect(commands[0]?.startsWith("/tellraw @a ")).toBe(true);
  });

  test("help trigger writes permitted agents", async () => {
    const commands: string[] = [];
    const router = new MentionRouter({
      config: fixtureConfig(),
      agentExecutor: { chat: async () => ({ runId: "run" }), runState: () => undefined },
      sendCommand: async (_serverId, line) => {
        commands.push(line);
        return { ok: true };
      },
      logSnapshot: () => snapshot([]),
    });

    router.handleLine("survival", "[12:00:00] [Server thread/INFO]: <Steve> !help");
    await eventually(() => commands.length === 1);

    expect(commands[0]).toContain("@bot");
  });
});

async function eventually(check: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  expect(check()).toBe(true);
}

function snapshot(lines: readonly string[]): LogBufferSnapshot {
  return {
    serverId: "survival",
    lines: lines.map((text, index) => ({ serverId: "survival", text, timestamp: index, byteLength: text.length })),
    bytes: 0,
    capacityBytes: 1_000,
    ingested: lines.length,
    droppedRateLimited: 0,
    droppedBufferFull: 0,
    evicted: 0,
  };
}

function fixtureConfig(): RuntimeConfig {
  return {
    schemaVersion: 1,
    servers: {
      survival: { id: "survival", name: "Survival", path: ".", jarFile: "server.jar", ram: 1024, javaPath: "java", serverPort: 25565, maxPlayers: 20, levelName: "world", startupTimeout: 120 },
    },
    providers: { mock: { name: "mock", type: "openai-compatible", model: "mock-model", apiKey: "test" } },
    agents: {
      assistant: { id: "assistant", name: "Assistant", alias: "bot", provider: "mock", systemPrompt: "Help players.", tools: [], commandAllowlist: [], timeout: 120, rateLimit: { rpm: 10, cooldown: 0 }, ingameMessageWindow: 1 },
    },
    permissions: { survival: { players: [{ name: "Steve", agents: ["assistant"], inGameAdmin: false }] } },
    featureFlags: { audioplayer: false },
    telemetry: { enabled: false },
    logging: { level: "info", rotationBytes: 50_000_000 },
    sessionRetention: "30d",
  };
}
