import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolSandboxBroker } from "../src/tools";
import type { RuntimeConfig } from "../src/config";
import type { ServerRuntimeSnapshot } from "../src/process";

describe("tool sandbox broker", () => {
  test("run_command allows configured token prefix and writes one console command", async () => {
    const dir = tempDir();
    const sent: string[] = [];
    try {
      const broker = new ToolSandboxBroker({ config: fixtureConfig(dir, { commandAllowlist: ["say", "whitelist add"] }), lifecycle: lifecycle("RUNNING", sent) });

      const result = await tool(broker, "run_command").execute({ command: "say Hello world" }, context());

      expect(result).toEqual({ ok: true, content: "sent say Hello world" });
      expect(sent).toEqual(["say Hello world"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("toolsFor exposes only configured v1 tools", () => {
    const dir = tempDir();
    try {
      const broker = new ToolSandboxBroker({ config: fixtureConfig(dir, { tools: ["read_file"] }), lifecycle: lifecycle("STOPPED", []) });

      expect(broker.toolsFor({ serverId: "survival", agentId: "assistant" }).map((tool) => tool.name)).toEqual(["read_file"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("run_command is deny-by-default and returns recoverable failures", async () => {
    const dir = tempDir();
    const sent: string[] = [];
    try {
      const broker = new ToolSandboxBroker({ config: fixtureConfig(dir), lifecycle: lifecycle("RUNNING", sent) });

      const result = await tool(broker, "run_command").execute({ command: "op Steve" }, context());

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.error).toContain("COMMAND_BLOCKED");
      expect(sent).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("run_command returns OFFLINE_FAIL when server is not running", async () => {
    const dir = tempDir();
    try {
      const broker = new ToolSandboxBroker({ config: fixtureConfig(dir, { commandAllowlist: ["say"] }), lifecycle: lifecycle("STOPPED", []) });

      const result = await tool(broker, "run_command").execute({ command: "say hi" }, context());

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.error).toContain("OFFLINE_FAIL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("read_file and write_file stay inside sandbox", async () => {
    const dir = tempDir();
    try {
      await mkdir(join(dir, "plugins", "my-agent"), { recursive: true });
      const broker = new ToolSandboxBroker({ config: fixtureConfig(dir), lifecycle: lifecycle("STOPPED", []) });

      const write = await tool(broker, "write_file").execute({ path: "plugins/my-agent/config.json", content: "{\"enabled\":true}" }, context());
      const read = await tool(broker, "read_file").execute({ path: "plugins/my-agent/config.json" }, context());
      const escape = await tool(broker, "read_file").execute({ path: "../secret.txt" }, context());

      expect(write.ok).toBe(true);
      expect(read).toEqual({ ok: true, content: "{\"enabled\":true}" });
      expect(escape.ok).toBe(false);
      expect(escape.ok ? "" : escape.error).toContain("PATH_TRAVERSAL_BLOCKED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("symlink escape is blocked", async () => {
    const dir = tempDir();
    const outside = tempDir();
    try {
      writeFileSync(join(outside, "secret.txt"), "nope", "utf8");
      try {
        symlinkSync(join(outside, "secret.txt"), join(dir, "linked.txt"));
      } catch {
        return;
      }
      const broker = new ToolSandboxBroker({ config: fixtureConfig(dir), lifecycle: lifecycle("STOPPED", []) });

      const result = await tool(broker, "read_file").execute({ path: "linked.txt" }, context());

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.error).toContain("PATH_TRAVERSAL_BLOCKED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("running server blocks NBT-sensitive writes", async () => {
    const dir = tempDir();
    try {
      await mkdir(join(dir, "world"), { recursive: true });
      const broker = new ToolSandboxBroker({ config: fixtureConfig(dir), lifecycle: lifecycle("RUNNING", []) });

      const result = await tool(broker, "write_file").execute({ path: "world/level.dat", content: "" }, context());

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.error).toContain("FILE_BLOCKED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("audit entries include digest and not raw file content", async () => {
    const dir = tempDir();
    const entries: unknown[] = [];
    try {
      const broker = new ToolSandboxBroker({
        config: fixtureConfig(dir),
        lifecycle: lifecycle("STOPPED", []),
        auditLog: { record: async (entry) => { entries.push(entry); } },
      });

      await tool(broker, "write_file").execute({ path: "config.txt", content: "secret-value" }, context());

      expect(JSON.stringify(entries)).toContain("argumentsDigest");
      expect(JSON.stringify(entries)).not.toContain("secret-value");
      expect(await readFile(join(dir, "config.txt"), "utf8")).toBe("secret-value");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function tool(broker: ToolSandboxBroker, name: string) {
  const tool = broker.toolsFor({ serverId: "survival", agentId: "assistant" }).find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function lifecycle(state: ServerRuntimeSnapshot["state"], sent: string[]) {
  return {
    snapshot: (serverId: string): ServerRuntimeSnapshot => ({ serverId, state }),
    async sendCommand(_serverId: string, line: string) {
      sent.push(line);
      return { ok: true };
    },
  };
}

function context() {
  return { toolCallId: "tool_1", principal: "Steve", signal: new AbortController().signal };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "explorers-cli-tools-"));
}

function fixtureConfig(path: string, agent: Partial<RuntimeConfig["agents"][string]> = {}): RuntimeConfig {
  return {
    schemaVersion: 1,
    servers: {
      survival: {
        id: "survival",
        name: "Survival",
        path,
        jarFile: "server.jar",
        ram: 1024,
        javaPath: "java",
        serverPort: 25565,
        maxPlayers: 20,
        levelName: "world",
        startupTimeout: 120,
      },
    },
    providers: { mock: { name: "mock", type: "openai-compatible", model: "mock-model", apiKey: "test" } },
    agents: {
      assistant: {
        id: "assistant",
        name: "Assistant",
        alias: "bot",
        provider: "mock",
        systemPrompt: "Help players.",
        tools: ["run_command", "read_file", "write_file"],
        commandAllowlist: [],
        timeout: 120,
        rateLimit: { rpm: 10, cooldown: 0 },
        ingameMessageWindow: 10,
        ...agent,
      },
    },
    permissions: { survival: { players: [] } },
    featureFlags: { audioplayer: false },
    telemetry: { enabled: false },
    logging: { level: "info", rotationBytes: 50_000_000 },
    sessionRetention: "30d",
  };
}
