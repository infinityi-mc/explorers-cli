import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import type { ServerConfig } from "../config/types";
import type { ServerState } from "../domain";
import { LineSplitter, type ServerLogStore } from "../log";
import type { PidRegistry } from "../persistence";

export const PROCESS_COMPONENT = "server-process-manager";

export interface ServerRuntimeSnapshot {
  readonly serverId: string;
  readonly state: ServerState;
  readonly pid?: number;
  readonly lastError?: string;
}

export interface ServerLifecycleManagerOptions {
  readonly servers: Readonly<Record<string, ServerConfig>>;
  readonly pidRegistry: PidRegistry;
  readonly spawn?: SpawnJava;
  readonly killPid?: KillPid;
  readonly portFree?: (port: number) => Promise<boolean>;
  readonly logStore?: Pick<ServerLogStore, "attach" | "ingest">;
}

export type LifecycleResult =
  | { readonly ok: true; readonly serverId: string; readonly state: ServerState; readonly pid?: number }
  | LifecycleFailure;

interface LifecycleFailure {
  readonly ok: false;
  readonly code: LifecycleErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export type LifecycleErrorCode =
  | "SERVER_NOT_FOUND"
  | "ALREADY_RUNNING"
  | "NOT_RUNNING"
  | "SERVER_PATH_NOT_FOUND"
  | "PATH_TRAVERSAL_BLOCKED"
  | "JAR_NOT_FOUND"
  | "JAVA_NOT_FOUND"
  | "PORT_CONFLICT"
  | "STARTUP_TIMEOUT"
  | "INTERNAL_ERROR";

export type SpawnJava = (request: SpawnJavaRequest) => ManagedChild;

export interface SpawnJavaRequest {
  readonly server: ServerConfig;
}

export interface ManagedChild {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr?: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number | null>;
  writeStdin(line: string): void | Promise<void>;
}

export type KillPid = (pid: number, force: boolean) => Promise<void>;

interface RuntimeEntry {
  state: ServerState;
  pid?: number;
  child?: ManagedChild;
  lastError?: string;
  intentionalStop?: boolean;
}

const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export class ServerLifecycleManager {
  private readonly runtime = new Map<string, RuntimeEntry>();

  constructor(private readonly options: ServerLifecycleManagerOptions) {}

  snapshot(serverId: string): ServerRuntimeSnapshot {
    const entry = this.runtime.get(serverId);
    if (entry === undefined) return { serverId, state: "STOPPED" };
    return { serverId, state: entry.state, pid: entry.pid, lastError: entry.lastError };
  }

  async start(serverId: string): Promise<LifecycleResult> {
    const server = this.options.servers[serverId];
    if (server === undefined) return failure("SERVER_NOT_FOUND", `No server named "${serverId}" is configured.`, { serverId });

    const entry = this.entry(serverId);
    if (entry.child !== undefined || entry.state === "RUNNING" || entry.state === "STARTING" || entry.state === "STOPPING") {
      return failure("ALREADY_RUNNING", `Server "${serverId}" is already in state ${entry.state}.`, { serverId, state: entry.state });
    }

    const validation = await this.validate(server);
    if (!validation.ok) return validation;

    entry.state = "STARTING";
    entry.lastError = undefined;
    entry.intentionalStop = false;

    let child: ManagedChild;
    try {
      child = (this.options.spawn ?? spawnJava)({ server });
    } catch (error) {
      const cause = String(error);
      entry.state = "FAILED";
      entry.lastError = cause;
      return failure("INTERNAL_ERROR", "Failed to spawn server process.", { serverId, cause });
    }

    entry.child = child;
    entry.pid = child.pid;
    try {
      await this.options.pidRegistry.set(serverId, child.pid);
      this.watchExit(serverId, entry, child);

      this.options.logStore?.attach(serverId, child.stderr, "[stderr] ");
      // startupTimeout is configured in seconds; waitForDoneAndIngest uses milliseconds.
      const startup = await waitForDoneAndIngest(child.stdout, server.startupTimeout * 1000, (line) => {
        this.options.logStore?.ingest(serverId, line);
      }, this.options.logStore !== undefined);
      if (!startup.ok) {
        entry.state = "FAILED";
        entry.lastError ??= "STARTUP_TIMEOUT";
        await this.cleanupStartedChild(serverId, entry, child);
        return failure("STARTUP_TIMEOUT", `Server "${serverId}" did not print "Done!" within ${server.startupTimeout}s.`, {
          serverId,
          startupTimeout: server.startupTimeout,
        });
      }

      entry.state = "RUNNING";
      return { ok: true, serverId, state: entry.state, pid: child.pid };
    } catch (error) {
      const cause = String(error);
      entry.state = "FAILED";
      entry.lastError = cause;
      await this.cleanupStartedChild(serverId, entry, child);
      return failure("INTERNAL_ERROR", "Failed to start server process.", { serverId, cause });
    }
  }

  async stop(serverId: string, force = false): Promise<LifecycleResult> {
    const server = this.options.servers[serverId];
    if (server === undefined) return failure("SERVER_NOT_FOUND", `No server named "${serverId}" is configured.`, { serverId });

    const entry = this.entry(serverId);
    const child = entry.child;
    const pid = entry.pid;
    if (child === undefined || pid === undefined || entry.state === "STOPPED") {
      return failure("NOT_RUNNING", `Server "${serverId}" is not running.`, { serverId });
    }

    entry.state = "STOPPING";
    entry.intentionalStop = true;
    if (!force) await child.writeStdin("/stop\n");

    const exited = await raceTimeout(child.exited, DEFAULT_STOP_TIMEOUT_MS);
    if (!exited) await this.kill(pid, true);

    if (entry.child === child) {
      await this.options.pidRegistry.delete(serverId);
      entry.state = "STOPPED";
      entry.pid = undefined;
      entry.child = undefined;
      entry.lastError = undefined;
    }
    return { ok: true, serverId, state: "STOPPED" };
  }

  async restart(serverId: string): Promise<LifecycleResult> {
    const current = this.entry(serverId);
    if (current.child !== undefined && current.state !== "STOPPED") {
      const stopped = await this.stop(serverId);
      if (!stopped.ok) return stopped;
    }
    return this.start(serverId);
  }

  async sendCommand(serverId: string, line: string): Promise<LifecycleResult> {
    const server = this.options.servers[serverId];
    if (server === undefined) return failure("SERVER_NOT_FOUND", `No server named "${serverId}" is configured.`, { serverId });
    const entry = this.runtime.get(serverId);
    if (entry?.child === undefined || entry.pid === undefined || entry.state !== "RUNNING") {
      return failure("NOT_RUNNING", `Server "${serverId}" is not running.`, { serverId });
    }
    const command = line.replace(/[\r\n]+$/g, "");
    if (/[\r\n]/.test(command)) return failure("INTERNAL_ERROR", "Console commands must be a single line.", { serverId });
    await entry.child.writeStdin(`${command}\n`);
    return { ok: true, serverId, state: entry.state, pid: entry.pid };
  }

  private async validate(server: ServerConfig): Promise<{ readonly ok: true } | LifecycleFailure> {
    let root: string;
    try {
      root = await realpath(server.path);
    } catch (error) {
      if (isMissingPath(error)) return failure("SERVER_PATH_NOT_FOUND", `Server path "${server.path}" does not exist.`, { path: server.path });
      return failure("PATH_TRAVERSAL_BLOCKED", "Server path could not be resolved.", { path: server.path });
    }

    const jarPath = resolve(root, server.jarFile);
    const rel = relative(root, jarPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return failure("PATH_TRAVERSAL_BLOCKED", "Path resolves outside the canonical server.path.", { path: server.path, jarFile: server.jarFile });
    }

    let canonicalJarPath: string;
    try {
      canonicalJarPath = await realpath(jarPath);
    } catch {
      return failure("JAR_NOT_FOUND", `JAR file "${server.jarFile}" not found inside ${server.path}.`, { jarFile: server.jarFile, path: server.path });
    }

    const canonicalRel = relative(root, canonicalJarPath);
    if (canonicalRel.startsWith("..") || isAbsolute(canonicalRel)) {
      return failure("PATH_TRAVERSAL_BLOCKED", "JAR path resolves outside the canonical server.path.", { path: server.path, jarFile: server.jarFile });
    }

    try {
      if (!(await stat(canonicalJarPath)).isFile()) throw new Error("not a file");
    } catch {
      return failure("JAR_NOT_FOUND", `JAR file "${server.jarFile}" not found inside ${server.path}.`, { jarFile: server.jarFile, path: server.path });
    }

    if (!(await executableExists(server.javaPath))) {
      return failure("JAVA_NOT_FOUND", `Java executable "${server.javaPath}" not found or not executable.`, { javaPath: server.javaPath });
    }

    if (!(await (this.options.portFree ?? isPortFree)(server.serverPort))) {
      return failure("PORT_CONFLICT", `Port ${server.serverPort} is already in use.`, { port: server.serverPort });
    }

    return { ok: true };
  }

  private watchExit(serverId: string, entry: RuntimeEntry, child: ManagedChild): void {
    child.exited.then(async (code) => {
      if (entry.child !== child) return;
      await this.options.pidRegistry.delete(serverId).catch(() => {});
      entry.pid = undefined;
      entry.child = undefined;
      if (entry.intentionalStop || entry.state === "STOPPING") {
        entry.state = "STOPPED";
        return;
      }
      entry.state = "FAILED";
      entry.lastError ??= `process exited with code ${code ?? "unknown"}`;
    }).catch(() => {});
  }

  private async cleanupStartedChild(serverId: string, entry: RuntimeEntry, child: ManagedChild): Promise<void> {
    try {
      await this.kill(child.pid, true);
    } catch {
      return;
    }

    await this.options.pidRegistry.delete(serverId).catch(() => {});
    if (entry.child === child) {
      entry.pid = undefined;
      entry.child = undefined;
    }
  }

  private entry(serverId: string): RuntimeEntry {
    const existing = this.runtime.get(serverId);
    if (existing !== undefined) return existing;
    const next: RuntimeEntry = { state: "STOPPED" };
    this.runtime.set(serverId, next);
    return next;
  }

  private kill(pid: number, force: boolean): Promise<void> {
    return (this.options.killPid ?? killPidTree)(pid, force).catch((error) => {
      if (!isMissingProcess(error)) throw error;
    });
  }
}

async function waitForDoneAndIngest(
  stream: ReadableStream<Uint8Array> | null,
  timeoutMs: number,
  onLine: (line: string) => void,
  continueAfterDone: boolean,
): Promise<{ readonly ok: true } | { readonly ok: false }> {
  if (stream === null) return { ok: false };
  const reader = stream.getReader();
  const splitter = new LineSplitter();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let foundDone = false;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    while (true) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next === "timeout" || next.done) return { ok: false };
      for (const line of splitter.push(next.value)) {
        onLine(line);
        if (line.includes("Done!")) foundDone = true;
      }
      if (foundDone) return { ok: true };
    }
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (!foundDone || !continueAfterDone) {
      try {
        await reader.cancel();
      } catch {
        // Startup outcome already decided; still release the stream lock below.
      }
    }
    reader.releaseLock();
    if (foundDone && continueAfterDone) void continueReading(stream, splitter, onLine).catch(() => {});
  }
}

async function continueReading(stream: ReadableStream<Uint8Array>, splitter: LineSplitter, onLine: (line: string) => void): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      for (const line of next.done ? splitter.flush() : splitter.push(next.value)) onLine(line);
      if (next.done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

function spawnJava({ server }: SpawnJavaRequest): ManagedChild {
  const child = Bun.spawn({
    cmd: [server.javaPath, `-Xmx${server.ram}M`, `-Xms${server.ram}M`, "-jar", server.jarFile, "nogui"],
    cwd: server.path,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    // POSIX detaches into a process group; Windows uses taskkill /T below.
    detached: process.platform !== "win32",
    env: withoutJavaToolOptions(process.env),
  });
  return {
    pid: child.pid,
    stdout: child.stdout,
    stderr: child.stderr,
    exited: child.exited,
    writeStdin(line) {
      child.stdin.write(new TextEncoder().encode(line));
    },
  };
}

async function killPidTree(pid: number, force: boolean): Promise<void> {
  if (process.platform === "win32") {
    // ponytail: Job Objects need reviewed native code; taskkill is the stdlib-free fallback for PHASE-004.
    await Bun.spawn({ cmd: ["taskkill", "/T", force ? "/F" : "", "/PID", String(pid)].filter(Boolean), stdout: "ignore", stderr: "ignore" }).exited;
    return;
  }

  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (!isMissingProcess(error)) throw error;
    }
  }
}

async function executableExists(command: string): Promise<boolean> {
  const candidates = isAbsolute(command) || command.includes("/") || command.includes("\\")
    ? [command]
    : (process.env.PATH ?? "").split(delimiter).flatMap((part) => executableCandidates(part, command));

  for (const candidate of candidates) {
    try {
      const candidateStat = await stat(candidate);
      if (!candidateStat.isFile()) continue;
      await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

function executableCandidates(pathPart: string, command: string): readonly string[] {
  if (process.platform !== "win32") return [join(pathPart, command)];
  return windowsExecutableNames(command).map((name) => join(pathPart, name));
}

function windowsExecutableNames(command: string): readonly string[] {
  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter((extension) => extension.length > 0);
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)];
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isMissingProcess(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

async function raceTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  return await Promise.race([promise.then(() => true), sleep(timeoutMs).then(() => false)]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withoutJavaToolOptions(env: NodeJS.ProcessEnv): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key !== "JAVA_TOOL_OPTIONS" && value !== undefined) next[key] = value;
  }
  return next;
}

function failure(code: LifecycleErrorCode, message: string, details?: Record<string, unknown>): LifecycleFailure {
  return { ok: false, code, message, details };
}
