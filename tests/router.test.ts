import { describe, expect, test } from "bun:test";
import {
  MUTATING_COMMANDS,
  NON_MUTATING_COMMANDS,
  OperatorRouter,
  classifyCommand,
  parseOperatorCommand,
} from "../src/router";

describe("operator router", () => {
  test("classifies every dispatch-table command", () => {
    const router = new OperatorRouter({ runtimeMode: "normal" });

    for (const command of router.dispatchTable.keys()) {
      expect(MUTATING_COMMANDS.has(command) || NON_MUTATING_COMMANDS.has(command)).toBe(true);
    }
  });

  test("blocks mutating commands in read-only mode before handlers", async () => {
    const router = new OperatorRouter({
      runtimeMode: "read-only",
      sessionStore: {
        clear: () => {
          throw new Error("handler should not run");
        },
      },
    });

    for (const command of MUTATING_COMMANDS) {
      expect(classifyCommand(command, "read-only")).toEqual({ allowed: false, reason: "READ_ONLY_BLOCKED" });
      const response = await router.route({ command, args: {}, idempotencyKey: crypto.randomUUID() });
      expect(response.status).toBe(403);
      expect("code" in response.body ? response.body.code : undefined).toBe("READ_ONLY_BLOCKED");
    }
  });

  test("allows non-mutating commands in read-only mode", async () => {
    const router = new OperatorRouter({ runtimeMode: "read-only" });

    for (const command of NON_MUTATING_COMMANDS) {
      expect(classifyCommand(command, "read-only")).toEqual({ allowed: true });
      expect((await router.route({ command, args: {} })).status).toBe(200);
    }
  });

  test("returns help with mutating flags and read-only banner data", async () => {
    const router = new OperatorRouter({ runtimeMode: "read-only" });
    const response = await router.route(parseOperatorCommand("/help"));

    expect(response.status).toBe(200);
    const body = response.body as { readOnly: boolean; commands: unknown[] };
    expect(body.readOnly).toBe(true);
    expect(body.commands).toContainEqual({
      name: "/start",
      summary: "Start a server.",
      mutating: true,
    });
    expect(body.commands).toContainEqual({
      name: "/session",
      summary: "List sessions.",
      mutating: false,
    });
  });

  test("implements initial session, resume, and clear seams", async () => {
    const session = {
      sessionId: "survival:assistant:1",
      serverId: "survival",
      agentId: "assistant",
      lastMessageAt: "2026-06-19T12:34:56Z",
      messageCount: 1,
    };
    const router = new OperatorRouter({
      runtimeMode: "normal",
      sessionStore: {
        list: () => [session],
        resume: (sessionId) => ({
          sessionId,
          serverId: "survival",
          agentId: "assistant",
          messages: [{ role: "user", content: "hello", timestamp: "2026-06-19T12:34:56Z" }],
        }),
        clear: () => 1,
      },
    });

    expect((await router.route(parseOperatorCommand("/session"))).body).toEqual({ items: [session] });
    expect((await router.route(parseOperatorCommand("/resume survival:assistant:1"))).body).toMatchObject({
      sessionId: "survival:assistant:1",
      messages: [{ content: "hello" }],
    });
    expect((await router.route(parseOperatorCommand("/clear survival assistant", "clear-key"))).body).toEqual({ cleared: 1 });
  });

  test("replays mutating responses inside idempotency TTL", async () => {
    let cleared = 0;
    let now = 1_000;
    const router = new OperatorRouter({
      runtimeMode: "normal",
      now: () => now,
      sessionStore: {
        clear: () => ++cleared,
      },
    });

    const first = await router.route(parseOperatorCommand("/clear survival assistant", "same-key"));
    const second = await router.route(parseOperatorCommand("/clear other other", "same-key"));
    now += 5_001;
    const third = await router.route(parseOperatorCommand("/clear survival assistant", "same-key"));

    expect(first.body).toEqual({ cleared: 1 });
    expect(second.body).toEqual({ cleared: 1 });
    expect(third.body).toEqual({ cleared: 2 });
  });

  test("shares in-flight mutating responses for the same idempotency key", async () => {
    let clearCalls = 0;
    let release: (() => void) | undefined;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const router = new OperatorRouter({
      runtimeMode: "normal",
      sessionStore: {
        clear: async () => {
          clearCalls++;
          await inFlight;
          return 1;
        },
      },
    });

    const first = router.route(parseOperatorCommand("/clear survival assistant", "same-key"));
    const second = router.route(parseOperatorCommand("/clear survival assistant", "same-key"));
    release?.();

    expect(await first).toEqual(await second);
    expect(clearCalls).toBe(1);
  });

  test("routes lifecycle commands to the server manager", async () => {
    const calls: string[] = [];
    const router = new OperatorRouter({
      runtimeMode: "normal",
      serverLifecycle: {
        start: async (serverId) => {
          calls.push(`start:${serverId}`);
          return { ok: true, serverId, state: "RUNNING", pid: 42 };
        },
        stop: async (serverId) => {
          calls.push(`stop:${serverId}`);
          return { ok: true, serverId, state: "STOPPED" };
        },
        restart: async (serverId) => {
          calls.push(`restart:${serverId}`);
          return { ok: false, code: "PORT_CONFLICT", message: "Port 25565 is already in use", details: { port: 25565 } };
        },
      },
    });

    expect(await router.route(parseOperatorCommand("/start survival", "start-key"))).toEqual({
      status: 200,
      body: { serverId: "survival", state: "RUNNING", pid: 42 },
    });
    expect(await router.route(parseOperatorCommand("/stop survival", "stop-key"))).toEqual({
      status: 200,
      body: { serverId: "survival", state: "STOPPED", pid: undefined },
    });
    expect(await router.route(parseOperatorCommand("/restart survival", "restart-key"))).toEqual({
      status: 422,
      body: { code: "PORT_CONFLICT", message: "Port 25565 is already in use", details: { port: 25565 } },
    });
    expect(calls).toEqual(["start:survival", "stop:survival", "restart:survival"]);
  });

  test("returns stable errors for missing sessions and absent later-phase handlers", async () => {
    const router = new OperatorRouter({
      runtimeMode: "normal",
      sessionStore: { resume: () => undefined },
    });

    const missingSession = await router.route(parseOperatorCommand("/resume missing-session"));
    expect(missingSession).toEqual({
      status: 404,
      body: {
        code: "SESSION_NOT_FOUND",
        message: "No session with id \"missing-session\".",
        details: { sessionId: "missing-session" },
      },
    });

    const placeholder = await router.route(parseOperatorCommand("/chat assistant hello", "chat-key"));
    expect(placeholder.status).toBe(501);
    expect("code" in placeholder.body ? placeholder.body.code : undefined).toBe("NOT_IMPLEMENTED");

    const missingServer = await router.route(parseOperatorCommand("/start", "missing-server-key"));
    expect(missingServer).toEqual({
      status: 400,
      body: { code: "MISSING_SERVER_ID", message: "No server was specified." },
    });

    const missingLifecycle = await router.route(parseOperatorCommand("/start survival", "missing-lifecycle-key"));
    expect(missingLifecycle.status).toBe(501);
    expect("code" in missingLifecycle.body ? missingLifecycle.body.code : undefined).toBe("NOT_IMPLEMENTED");
  });
});
