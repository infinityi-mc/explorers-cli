import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRuntimeConfig, parseRuntimeOptions } from "../src/config";

describe("runtime config", () => {
  test("missing config.yaml boots with defaults", async () => {
    const dir = tempDir();
    try {
      const result = await loadRuntimeConfig({ configPath: join(dir, "config.yaml"), env: {} });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.configExisted).toBe(false);
      expect(result.value.config.servers).toEqual({});
      expect(result.value.config.agents).toEqual({});
      expect(result.value.config.featureFlags.audioplayer).toBe(false);
      expect(result.value.config.telemetry.enabled).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loads YAML arrays and resolves provider secrets from env", async () => {
    const dir = tempDir();
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `servers:
  - id: survival
    name: Survival
    path: ./servers/survival
    jarFile: server.jar
    javaPath: java
    serverPort: 25565
    levelName: world
providers:
  - name: openai
    type: openai
    model: gpt-test
    apiKey: \${OPENAI_API_KEY}
agents:
  - id: assistant
    name: Assistant
    alias: bot
    provider: openai
    systemPrompt: Help players.
    tools: []
    commandAllowlist: []
permissions:
  survival:
    players:
      - name: Steve
        agents: [assistant]
`,
      "utf8",
    );

    try {
      const result = await loadRuntimeConfig({
        configPath,
        env: { OPENAI_API_KEY: "provider-test-secret" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.configExisted).toBe(true);
      expect(result.value.config.servers.survival?.startupTimeout).toBe(120);
      expect(result.value.config.providers.openai?.apiKey).toBe("provider-test-secret");
      expect(result.value.config.agents.assistant?.rateLimit.rpm).toBe(10);
      expect(result.value.config.permissions.survival?.players[0]?.name).toBe("Steve");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports invalid config diagnostics without raw secret values", async () => {
    const dir = tempDir();
    const configPath = join(dir, "config.yaml");
    writeFileSync(
      configPath,
      `providers:
  - name: openai
    type: openai
    model: gpt-test
    apiKey: plaintext-secret
agents:
  - id: bad id
    name: Assistant
    alias: x
    provider: missing
    systemPrompt: Help players.
    tools: []
    commandAllowlist: []
`,
      "utf8",
    );

    try {
      const result = await loadRuntimeConfig({ configPath, env: {} });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const reasons = result.diagnostics.map((issue) => issue.reason).join("\n");
      expect(reasons).toContain("environment reference");
      expect(reasons).toContain("Unknown provider");
      expect(JSON.stringify(result.diagnostics)).not.toContain("plaintext-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("parses runtime modes", () => {
    expect(parseRuntimeOptions(["--read-only"])).toMatchObject({
      ok: true,
      value: { mode: "read-only" },
    });
    expect(parseRuntimeOptions(["--validate-config"])).toMatchObject({
      ok: true,
      value: { mode: "validate-config" },
    });
    expect(parseRuntimeOptions(["--config"])).toMatchObject({ ok: false });
  });
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "explorers-cli-"));
}
