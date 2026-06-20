import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRuntimeConfig, parseRuntimeOptions } from "../src/config";
import { bootExplorers } from "../src/lifecycle";

describe("lifecycle", () => {
  test("starts TUI after foundation components and stops it on shutdown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "explorers-cli-"));
    const loaded = await loadRuntimeConfig({ configPath: join(dir, "config.yaml"), env: {} });
    const runtime = parseRuntimeOptions([]);
    const events: string[] = [];
    let exitCode: number | undefined;

    try {
      expect(loaded.ok).toBe(true);
      expect(runtime.ok).toBe(true);
      if (!loaded.ok || !runtime.ok) return;

      const app = await bootExplorers({
        loaded: loaded.value,
        runtime: runtime.value,
        startTui: async (viewModel) => {
          events.push(`tui:start:${viewModel.serverCount}`);
          return () => events.push("tui:stop");
        },
        installSignals: false,
        exit: ((code: number) => {
          exitCode = code;
          return undefined as never;
        }),
      });

      expect(app.ready).toBe(true);
      expect(events).toEqual(["tui:start:0"]);
      await app.stop("test");
      expect(events).toEqual(["tui:start:0", "tui:stop"]);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("startTimeout is independent from shutdownTimeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "explorers-cli-"));
    const loaded = await loadRuntimeConfig({ configPath: join(dir, "config.yaml"), env: {} });
    const runtime = parseRuntimeOptions([]);
    let exitCode: number | undefined;

    try {
      expect(loaded.ok).toBe(true);
      expect(runtime.ok).toBe(true);
      if (!loaded.ok || !runtime.ok) return;

      const app = await bootExplorers({
        loaded: loaded.value,
        runtime: runtime.value,
        shutdownTimeout: 1,
        startTimeout: 100,
        startTui: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return () => {};
        },
        installSignals: false,
        exit: ((code: number) => {
          exitCode = code;
          return undefined as never;
        }),
      });

      expect(app.ready).toBe(true);
      await app.stop("test");
      expect(exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
