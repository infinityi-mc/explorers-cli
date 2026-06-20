import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";

describe("cli", () => {
  test("--validate-config exits before TUI or lifecycle side effects", async () => {
    const dir = tempDir();
    let tuiStarted = false;
    let stdout = "";

    try {
      const result = await runCli({
        argv: ["--validate-config", "--config", join(dir, "config.yaml")],
        env: {},
        stdout: { write: (chunk: string) => { stdout += chunk; return true; } },
        stderr: { write: () => true },
        startTui: async () => {
          tuiStarted = true;
          return () => {};
        },
        installSignals: false,
      });

      expect(result).toEqual({ kind: "exit", code: 0 });
      expect(stdout).toContain("Config valid");
      expect(tuiStarted).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--validate-config returns non-zero on invalid YAML shape", async () => {
    const dir = tempDir();
    const configPath = join(dir, "config.yaml");
    writeFileSync(configPath, "servers: nope\n", "utf8");
    let stderr = "";

    try {
      const result = await runCli({
        argv: ["--validate-config", "--config", configPath],
        env: {},
        stdout: { write: () => true },
        stderr: { write: (chunk: string) => { stderr += chunk; return true; } },
        installSignals: false,
      });

      expect(result).toEqual({ kind: "exit", code: 1 });
      expect(stderr).toContain("SERVERS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "explorers-cli-"));
}
