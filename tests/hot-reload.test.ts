import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRuntimeConfig, tryReloadConfig, type RuntimeOptions } from "../src/config";
import type { ServerState } from "../src/domain";

describe("config hot reload", () => {
  test("deleted config is rejected and keeps previous snapshot", async () => {
    const dir = tempDir();
    const configPath = join(dir, "config.yaml");
    writeFileSync(configPath, configYaml({ agentId: "assistant" }), "utf8");
    try {
      const current = await loaded(configPath);
      unlinkSync(configPath);

      const outcome = await tryReloadConfig({ current, runtime: runtime(configPath), env: env(), getServerState: stopped });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.kept.config.agents.assistant).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid schema is rejected and keeps previous snapshot", async () => {
    const dir = tempDir();
    const configPath = join(dir, "config.yaml");
    writeFileSync(configPath, configYaml({ agentId: "assistant" }), "utf8");
    try {
      const current = await loaded(configPath);
      writeFileSync(configPath, "servers: not-an-array\n", "utf8");

      const outcome = await tryReloadConfig({ current, runtime: runtime(configPath), env: env(), getServerState: stopped });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.kept.config.servers.survival).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("adding agent reloads and rebuilds indexes", async () => {
    const dir = tempDir();
    const configPath = join(dir, "config.yaml");
    writeFileSync(configPath, configYaml({ agentId: "assistant" }), "utf8");
    try {
      const current = await loaded(configPath);
      writeFileSync(configPath, configYaml({ agentId: "builder" }), "utf8");

      const outcome = await tryReloadConfig({ current, runtime: runtime(configPath), env: env(), getServerState: stopped });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.loaded.config.agents.builder).toBeDefined();
        expect(outcome.indexes.agents.get("builder")).toBeDefined();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("removing running server is rejected", async () => {
    const dir = tempDir();
    const configPath = join(dir, "config.yaml");
    writeFileSync(configPath, configYaml({ agentId: "assistant" }), "utf8");
    try {
      const current = await loaded(configPath);
      writeFileSync(configPath, "servers: []\nproviders: []\nagents: []\npermissions: {}\n", "utf8");

      const outcome = await tryReloadConfig({ current, runtime: runtime(configPath), env: env(), getServerState: () => "RUNNING" });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.diagnostics[0]?.reason).toContain("Cannot remove survival");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("process-affecting field change marks pending restart", async () => {
    const dir = tempDir();
    const configPath = join(dir, "config.yaml");
    writeFileSync(configPath, configYaml({ agentId: "assistant", port: 25565 }), "utf8");
    try {
      const current = await loaded(configPath);
      writeFileSync(configPath, configYaml({ agentId: "assistant", port: 25566 }), "utf8");

      const outcome = await tryReloadConfig({ current, runtime: runtime(configPath), env: env(), getServerState: () => "RUNNING" });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.pendingRestart.has("survival")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

async function loaded(configPath: string) {
  const result = await loadRuntimeConfig({ configPath, env: env() });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("config fixture invalid");
  return result.value;
}

function runtime(configPath: string): RuntimeOptions {
  return { mode: "normal", configPath, verbose: false, argv: [] };
}

function stopped(): ServerState {
  return "STOPPED";
}

function env(): Readonly<Record<string, string>> {
  return { OPENAI_API_KEY: "test-key" };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "explorers-cli-hot-reload-"));
}

function configYaml(options: { readonly agentId: string; readonly port?: number }): string {
  return `servers:
  - id: survival
    name: Survival
    path: ./servers/survival
    jarFile: server.jar
    javaPath: java
    serverPort: ${options.port ?? 25565}
    levelName: world
providers:
  - name: openai
    type: openai
    model: gpt-test
    apiKey: \${OPENAI_API_KEY}
agents:
  - id: ${options.agentId}
    name: Assistant
    alias: bot${options.agentId}
    provider: openai
    systemPrompt: Help players.
    tools: []
    commandAllowlist: []
permissions:
  survival:
    players:
      - name: Steve
        agents: [${options.agentId}]
`;
}
