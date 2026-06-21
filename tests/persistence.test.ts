import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPidRegistry,
  inspectStalePid,
  startPersistence,
} from "../src/persistence";

describe("persistence", () => {
  test("creates lock, PID registry, and idempotent SQLite migrations", async () => {
    const dir = tempDir();
    try {
      const first = await startPersistence({ dataDir: dir });
      await first.stop();

      const second = await startPersistence({ dataDir: dir });
      await second.stop();

      expect(existsSync(join(dir, "pids.json"))).toBe(true);
      expect(existsSync(join(dir, "sessions.db"))).toBe(true);

      const db = new Database(join(dir, "sessions.db"), { readonly: true });
      try {
        expect(tableExists(db, "engine_session_sessions")).toBe(true);
        expect(tableExists(db, "engine_session_messages")).toBe(true);
        expect(tableExists(db, "audit_entries")).toBe(true);
        expect(tableExists(db, "pruning_state")).toBe(true);
        expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects a second manager lock", async () => {
    const dir = tempDir();
    try {
      const first = await startPersistence({ dataDir: dir });
      try {
        await expect(startPersistence({ dataDir: dir })).rejects.toThrow("LOCK_HELD");
      } finally {
        await first.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("atomically maintains pids.json without overwriting existing state", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "pids.json");
      const registry = await createPidRegistry(path);
      await registry.set("server-a", 123);

      const sameFile = await createPidRegistry(path);
      expect(await sameFile.read()).toEqual({ "server-a": 123 });

      await sameFile.delete("server-a");
      expect(await sameFile.read()).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("models stale PID verification without killing processes", async () => {
    const commands = new Map<number, string | undefined>([
      [1, undefined],
      [2, "node unrelated.js"],
      [3, "java -jar server.jar"],
    ]);

    const inspector = { commandLine: async (pid: number) => commands.get(pid) };
    expect(await inspectStalePid(undefined, "server.jar", inspector)).toBe("missing");
    expect(await inspectStalePid(1, "server.jar", inspector)).toBe("stale");
    expect(await inspectStalePid(2, "server.jar", inspector)).toBe("reused");
    expect(await inspectStalePid(3, "server.jar", inspector)).toBe("owned");
  });
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "explorers-cli-"));
}

function tableExists(db: Database, name: string): boolean {
  return db
    .query("select name from sqlite_master where type = 'table' and name = ?")
    .get(name) !== null;
}
