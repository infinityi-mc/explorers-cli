import { Database } from "bun:sqlite";
import { createDb, sql, type Db } from "@infinityi/forge/data";
import {
  createSqliteDialect,
  createSqliteDriver,
} from "@infinityi/forge/data/dialects/sqlite";
import { forgeDataAuditLog } from "@infinityi/engine-lib/governance";
import { ForgeDataSessionStore } from "@infinityi/engine-lib/session-stores";
import type { SessionStore } from "@infinityi/engine-lib/session";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "@infinityi/forge/lifecycle";

export const PERSISTENCE_COMPONENT = "persistence";

export interface PersistenceState {
  readonly dataDir: string;
  readonly lockPath: string;
  readonly pidsPath: string;
  readonly dbPath: string;
  readonly pidRegistry: PidRegistry;
  readonly sessionStore: SessionStore;
  readonly db: Db<Record<string, Record<string, unknown>>>;
  stop(): Promise<void>;
}

export interface PidRegistry {
  read(): Promise<Record<string, number>>;
  set(key: string, pid: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ProcessInspector {
  commandLine(pid: number): Promise<string | undefined>;
}

export type StalePidDecision = "missing" | "stale" | "reused" | "owned";

export async function startPersistence(options: {
  readonly dataDir: string;
  readonly logger?: Logger;
}): Promise<PersistenceState> {
  await mkdir(options.dataDir, { recursive: true });

  const lockPath = join(options.dataDir, "explorers.lock");
  await acquireLock(lockPath);
  let sessionStore: ForgeDataSessionStore | undefined;
  let db: Db<Record<string, Record<string, unknown>>> | undefined;

  try {
    const pidsPath = join(options.dataDir, "pids.json");
    const pidRegistry = await createPidRegistry(pidsPath);

    const dbPath = join(options.dataDir, "sessions.db");
    const sqlite = new Database(dbPath, { create: true });
    sqlite.exec("PRAGMA journal_mode=WAL;");
    sqlite.exec("PRAGMA foreign_keys=ON;");

    db = createDb({
      dialect: createSqliteDialect(),
      driver: createSqliteDriver({ database: sqlite }),
    });
    sessionStore = new ForgeDataSessionStore({ db });
    await sessionStore.migrate();
    await forgeDataAuditLog({ db, table: "audit_entries" }).migrate();
    await db.raw(sql`
      create table if not exists pruning_state (
        sessionId text primary key,
        lastPrunedAt text not null,
        messageCountAtPrune integer not null
      )
    `).execute();

    options.logger?.info("persistence.started", { dataDir: options.dataDir });

    return {
      dataDir: options.dataDir,
      lockPath,
      pidsPath,
      dbPath,
      pidRegistry,
      sessionStore,
      db,
      async stop() {
        const cleanupErrors: unknown[] = [];
        try {
          try {
            await sessionStore?.close();
          } catch (error) {
            cleanupErrors.push(error);
          }
          try {
            await db?.shutdown();
          } catch (error) {
            cleanupErrors.push(error);
          }
        } finally {
          try {
            await releaseLock(lockPath);
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Failed to stop persistence cleanly.");
      },
    };
  } catch (error) {
    await sessionStore?.close().catch(() => {});
    await db?.shutdown().catch(() => {});
    await releaseLock(lockPath).catch(() => {});
    throw error;
  }
}

export async function createPidRegistry(path: string): Promise<PidRegistry> {
  try {
    const file = await open(path, "wx");
    await file.writeFile("{}\n", "utf8");
    await file.close();
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
  }

  return {
    read: () => readPidFile(path),
    async set(key, pid) {
      const current = await readPidFile(path);
      current[key] = pid;
      await writePidFile(path, current);
    },
    async delete(key) {
      const current = await readPidFile(path);
      delete current[key];
      await writePidFile(path, current);
    },
  };
}

export async function inspectStalePid(
  pid: number | undefined,
  expectedCommandFragment: string,
  inspector: ProcessInspector,
): Promise<StalePidDecision> {
  if (pid === undefined) return "missing";
  const commandLine = await inspector.commandLine(pid);
  if (commandLine === undefined) return "stale";
  return commandLine.includes(expectedCommandFragment) ? "owned" : "reused";
}

async function acquireLock(path: string): Promise<void> {
  try {
    const file = await open(path, "wx");
    // ponytail: native exclusive-create is enough for PHASE-002; PHASE-004 owns OS process cleanup.
    await file.writeFile(`${process.pid}\n`, "utf8");
    await file.close();
  } catch (error) {
    if (isFileExistsError(error)) {
      if (await clearStaleLock(path)) return acquireLock(path);
      throw new Error(`LOCK_HELD: another explorers-cli instance owns ${path}`);
    }
    throw error;
  }
}

async function clearStaleLock(path: string): Promise<boolean> {
  const raw = await readFile(path, "utf8").catch(() => undefined);
  const pid = raw === undefined ? undefined : Number.parseInt(raw, 10);
  if (pid !== undefined && Number.isInteger(pid) && pid > 0 && isPidAlive(pid)) return false;
  await rm(path, { force: true });
  return true;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function releaseLock(path: string): Promise<void> {
  await rm(path, { force: true });
}

async function readPidFile(path: string): Promise<Record<string, number>> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid PID registry: ${path}`);
  }

  const pids: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new Error(`invalid PID registry entry: ${key}`);
    }
    pids[key] = value;
  }
  return pids;
}

async function writePidFile(path: string, pids: Record<string, number>): Promise<void> {
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(pids, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
