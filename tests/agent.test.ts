import { describe, expect, test } from "bun:test";
import { ProviderError } from "@infinityi/engine-lib/errors";
import { InMemorySessionStore } from "@infinityi/engine-lib/session";
import { mockProvider } from "@infinityi/engine-lib/testing";
import { AgentExecutor, mapAgentExecutorError } from "../src/agent";
import type { RuntimeConfig } from "../src/config";
import type { Provider } from "@infinityi/engine-lib/providers";

describe("agent executor", () => {
  test("online chat streams and persists shared session turns", async () => {
    const store = new InMemorySessionStore();
    const executor = new AgentExecutor({
      config: fixtureConfig(),
      sessionStore: store,
      providers: { mock: mockProvider({ events: [{ type: "message_start", model: "mock-model" }, { type: "text_delta", text: "hello" }, { type: "finish", finishReason: "stop" }] }) },
      now: () => 1_760_704_496_123,
    });

    const run = await executor.chat({ serverId: "survival", agentId: "assistant", message: "hi" });
    await executor.runHandle(run.runId)?.completed;

    expect(run).toMatchObject({ agentId: "assistant", stream: true });
    const sessions = await executor.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toMatch(/^survival:assistant:1760704496123-[a-z0-9]{6}$/);

    const detail = await executor.resume(sessions[0]!.sessionId);
    expect(detail?.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "hi"],
      ["assistant", "hello"],
    ]);
  });

  test("offline chat uses ephemeral session", async () => {
    const store = new InMemorySessionStore();
    const executor = new AgentExecutor({
      config: fixtureConfig(),
      sessionStore: store,
      providers: { mock: mockProvider() },
    });

    const run = await executor.chat({ agentId: "assistant", message: "hi" });
    await executor.runHandle(run.runId)?.completed;

    expect(await executor.list()).toEqual([]);
  });

  test("clear drops cached handle only", async () => {
    const store = new InMemorySessionStore();
    const executor = new AgentExecutor({
      config: fixtureConfig(),
      sessionStore: store,
      providers: { mock: mockProvider() },
      now: () => 1_760_704_496_123,
    });

    const first = await executor.chat({ serverId: "survival", agentId: "assistant", message: "one" });
    await executor.runHandle(first.runId)?.completed;
    const oldId = (await executor.list())[0]!.sessionId;

    expect(executor.clear({ serverId: "survival", agentId: "assistant" })).toBe(1);
    const second = await executor.chat({ serverId: "survival", agentId: "assistant", message: "two" });
    await executor.runHandle(second.runId)?.completed;

    expect((await executor.list()).map((session) => session.sessionId)).toContain(oldId);
  });

  test("maps provider errors to stable operator codes", () => {
    expect(mapAgentExecutorError(new ProviderError("busy", { status: 429 })).code).toBe("PROVIDER_RATE_LIMITED");
    expect(mapAgentExecutorError(new ProviderError("down", { status: 503 })).code).toBe("PROVIDER_UNAVAILABLE");
  });

  test("records failed terminal run state", async () => {
    const executor = new AgentExecutor({
      config: fixtureConfig(),
      providers: { mock: failingProvider(new ProviderError("busy", { status: 429 })) },
    });

    const run = await executor.chat({ agentId: "assistant", message: "hi" });
    await eventually(() => executor.runState(run.runId)?.status === "failed");

    const state = executor.runState(run.runId);
    expect(state?.status).toBe("failed");
    expect(state?.status === "failed" ? state.error.code : undefined).toBe("PROVIDER_RATE_LIMITED");
    expect(executor.runHandle(run.runId)).toBeUndefined();
  });
});

function failingProvider(error: Error): Provider {
  return {
    name: "mock",
    defaultModel: "mock-model",
    capabilities: { tools: true, streaming: true, multimodalInput: false, parallelToolCalls: false, structuredOutput: false },
    async complete() {
      throw error;
    },
    async *stream() {
      throw error;
    },
  };
}

async function eventually(check: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(check()).toBe(true);
}

function fixtureConfig(): RuntimeConfig {
  return {
    schemaVersion: 1,
    servers: {
      survival: {
        id: "survival",
        name: "Survival",
        path: ".",
        jarFile: "server.jar",
        ram: 1024,
        javaPath: "java",
        serverPort: 25565,
        maxPlayers: 20,
        levelName: "world",
        startupTimeout: 120,
      },
    },
    providers: {
      mock: { name: "mock", type: "openai-compatible", model: "mock-model", apiKey: "test" },
    },
    agents: {
      assistant: {
        id: "assistant",
        name: "Assistant",
        alias: "bot",
        provider: "mock",
        systemPrompt: "Help players.",
        tools: [],
        commandAllowlist: [],
        timeout: 120,
        rateLimit: { rpm: 10, cooldown: 0 },
        ingameMessageWindow: 10,
      },
    },
    permissions: { survival: { players: [] } },
    featureFlags: { audioplayer: false },
    telemetry: { enabled: false },
    logging: { level: "info", rotationBytes: 50_000_000 },
    sessionRetention: "30d",
  };
}
