import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../src/config/types";
import { ServerLogStore } from "../src/log";
import { ServerLifecycleManager, type ManagedChild } from "../src/process";

describe("server lifecycle manager", () => {
  test("starts after Done!, records PID, stops, and deletes PID", async () => {
    const dir = tempDir();
    try {
      const pids: Record<string, number> = {};
      let stdin = "";
      const child = stubChild({ pid: 123, stdout: "Preparing\nDone!\n" });
      const manager = new ServerLifecycleManager({
        servers: { survival: serverConfig(dir) },
        pidRegistry: registry(pids),
        spawn: () => ({ ...child, writeStdin: (line) => { stdin += line; child.resolveExit(0); } }),
        portFree: async () => true,
        killPid: async () => {},
      });

      expect(await manager.start("survival")).toEqual({ ok: true, serverId: "survival", state: "RUNNING", pid: 123 });
      expect(pids).toEqual({ survival: 123 });
      expect(await manager.stop("survival")).toEqual({ ok: true, serverId: "survival", state: "STOPPED" });
      expect(stdin).toBe("/stop\n");
      expect(pids).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sendCommand rejects embedded newlines", async () => {
    const dir = tempDir();
    try {
      let stdin = "";
      const child = stubChild({ pid: 126, stdout: "Done!\n" });
      const manager = new ServerLifecycleManager({
        servers: { survival: serverConfig(dir) },
        pidRegistry: registry({}),
        spawn: () => ({ ...child, writeStdin: (line) => { stdin += line; } }),
        portFree: async () => true,
        killPid: async () => {},
      });

      await manager.start("survival");
      const result = await manager.sendCommand("survival", "/say hi\n/op Steve");

      expect(result.ok).toBe(false);
      expect(stdin).toBe("");
      child.resolveExit(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stop tolerates exit watcher cleanup while stdin write is still pending", async () => {
    const dir = tempDir();
    try {
      const pids: Record<string, number> = {};
      const child = stubChild({ pid: 124, stdout: "Done!\n" });
      const manager = new ServerLifecycleManager({
        servers: { survival: serverConfig(dir) },
        pidRegistry: registry(pids),
        spawn: () => ({
          ...child,
          writeStdin: async () => {
            child.resolveExit(0);
            await Bun.sleep(0);
          },
        }),
        portFree: async () => true,
        killPid: async () => {},
      });

      await manager.start("survival");
      expect(await manager.stop("survival")).toEqual({ ok: true, serverId: "survival", state: "STOPPED" });
      expect(pids).toEqual({});
      expect(manager.snapshot("survival").state).toBe("STOPPED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not start a new child while stop is in progress", async () => {
    const dir = tempDir();
    try {
      const pids: Record<string, number> = {};
      const child = stubChild({ pid: 125, stdout: "Done!\n" });
      let releaseStop: (() => void) | undefined;
      let stopWriteStarted: (() => void) | undefined;
      const stopPending = new Promise<void>((resolve) => { releaseStop = resolve; });
      const stopWriteStartedPromise = new Promise<void>((resolve) => { stopWriteStarted = resolve; });
      let spawnCount = 0;
      const manager = new ServerLifecycleManager({
        servers: { survival: serverConfig(dir) },
        pidRegistry: registry(pids),
        spawn: () => {
          spawnCount++;
          return {
            ...child,
            writeStdin: async () => {
              stopWriteStarted?.();
              await stopPending;
              child.resolveExit(0);
            },
          };
        },
        portFree: async () => true,
        killPid: async () => {},
      });

      await manager.start("survival");
      const stop = manager.stop("survival");
      await stopWriteStartedPromise;

      const result = await manager.start("survival");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ALREADY_RUNNING");
        expect(result.details).toMatchObject({ state: "STOPPING" });
      }

      releaseStop?.();
      expect(await stop).toEqual({ ok: true, serverId: "survival", state: "STOPPED" });
      expect(spawnCount).toBe(1);
      expect(pids).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("maps validation failures", async () => {
    const dir = tempDir();
    try {
      const manager = new ServerLifecycleManager({
        servers: { survival: { ...serverConfig(dir), jarFile: "../server.jar" } },
        pidRegistry: registry({}),
        portFree: async () => true,
      });

      const traversal = await manager.start("survival");
      expect(traversal.ok).toBe(false);
      if (!traversal.ok) expect(traversal.code).toBe("PATH_TRAVERSAL_BLOCKED");

      const missingPath = new ServerLifecycleManager({
        servers: { survival: { ...serverConfig(dir), path: join(dir, "missing") } },
        pidRegistry: registry({}),
        portFree: async () => true,
      });
      const path = await missingPath.start("survival");
      expect(path.ok).toBe(false);
      if (!path.ok) expect(path.code).toBe("SERVER_PATH_NOT_FOUND");

      const missingJar = new ServerLifecycleManager({
        servers: { survival: { ...serverConfig(dir), jarFile: "missing.jar" } },
        pidRegistry: registry({}),
        portFree: async () => true,
      });
      const jar = await missingJar.start("survival");
      expect(jar.ok).toBe(false);
      if (!jar.ok) expect(jar.code).toBe("JAR_NOT_FOUND");

      const port = new ServerLifecycleManager({
        servers: { survival: serverConfig(dir) },
        pidRegistry: registry({}),
        portFree: async () => false,
      });
      const conflict = await port.start("survival");
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.code).toBe("PORT_CONFLICT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects jar symlinks that resolve outside server path", async () => {
    const dir = tempDir();
    const outside = tempDir();
    try {
      const config = serverConfig(dir);
      unlinkSync(join(dir, "server.jar"));
      writeFileSync(join(outside, "evil.jar"), "stub", "utf8");
      try {
        symlinkSync(join(outside, "evil.jar"), join(dir, "server.jar"), "file");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }

      const manager = new ServerLifecycleManager({
        servers: { survival: config },
        pidRegistry: registry({}),
        portFree: async () => true,
      });

      const result = await manager.start("survival");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PATH_TRAVERSAL_BLOCKED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("times out hung startup and force kills", async () => {
    const dir = tempDir();
    try {
      const killed: number[] = [];
      const manager = new ServerLifecycleManager({
        servers: { survival: { ...serverConfig(dir), startupTimeout: 0.01 } },
        pidRegistry: registry({}),
        spawn: () => stubChild({ pid: 99, stdout: "still loading\n" }),
        portFree: async () => true,
        killPid: async (pid) => { killed.push(pid); },
      });

      const result = await manager.start("survival");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("STARTUP_TIMEOUT");
      expect(killed).toEqual([99]);
      expect(manager.snapshot("survival").state).toBe("FAILED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves process exit reason when the child exits before startup completes", async () => {
    const dir = tempDir();
    try {
      const stdout = controlledStdout();
      const child = stubChild({ pid: 96, stdout: stdout.stream });
      let spawned: (() => void) | undefined;
      const spawnedPromise = new Promise<void>((resolve) => { spawned = resolve; });
      const manager = new ServerLifecycleManager({
        servers: { survival: serverConfig(dir) },
        pidRegistry: registry({}),
        spawn: () => {
          spawned?.();
          return child;
        },
        portFree: async () => true,
        killPid: async () => {},
      });

      const start = manager.start("survival");
      await spawnedPromise;
      child.resolveExit(1);
      await Bun.sleep(0);
      stdout.close();

      const result = await start;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("STARTUP_TIMEOUT");
      expect(manager.snapshot("survival").lastError).toBe("process exited with code 1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("startup timeout treats an already-exited process as killed", async () => {
    const dir = tempDir();
    try {
      const pids: Record<string, number> = {};
      const manager = new ServerLifecycleManager({
        servers: { survival: { ...serverConfig(dir), startupTimeout: 0.01 } },
        pidRegistry: registry(pids),
        spawn: () => stubChild({ pid: 98, stdout: "still loading\n" }),
        portFree: async () => true,
        killPid: async () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); },
      });

      const result = await manager.start("survival");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("STARTUP_TIMEOUT");
      expect(pids).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("startup timeout returns typed failure when force kill fails", async () => {
    const dir = tempDir();
    try {
      const pids: Record<string, number> = {};
      const manager = new ServerLifecycleManager({
        servers: { survival: { ...serverConfig(dir), startupTimeout: 0.01 } },
        pidRegistry: registry(pids),
        spawn: () => stubChild({ pid: 95, stdout: "still loading\n" }),
        portFree: async () => true,
        killPid: async () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); },
      });

      const result = await manager.start("survival");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("STARTUP_TIMEOUT");
      expect(manager.snapshot("survival")).toMatchObject({ state: "FAILED", pid: 95, lastError: "STARTUP_TIMEOUT" });
      expect(pids).toEqual({ survival: 95 });

      const retry = await manager.start("survival");
      expect(retry.ok).toBe(false);
      if (!retry.ok) expect(retry.code).toBe("ALREADY_RUNNING");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cleans up and reports internal error when PID registry write fails", async () => {
    const dir = tempDir();
    try {
      const pids: Record<string, number> = {};
      const killed: number[] = [];
      const child = stubChild({ pid: 94, stdout: "Done!\n" });
      const manager = new ServerLifecycleManager({
        servers: { survival: serverConfig(dir) },
        pidRegistry: {
          read: async () => pids,
          set: async () => { throw new Error("disk full"); },
          delete: async (key: string) => { delete pids[key]; },
        },
        spawn: () => child,
        portFree: async () => true,
        killPid: async (pid) => {
          killed.push(pid);
          child.resolveExit(137);
        },
      });

      const result = await manager.start("survival");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INTERNAL_ERROR");
        expect(result.details).toMatchObject({ serverId: "survival", cause: "Error: disk full" });
      }
      expect(killed).toEqual([94]);
      expect(manager.snapshot("survival").state).toBe("FAILED");

      const retry = await manager.start("survival");
      expect(retry.ok).toBe(false);
      if (!retry.ok) expect(retry.code).not.toBe("ALREADY_RUNNING");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cleans up and reports internal error when stdout reading fails", async () => {
    const dir = tempDir();
    try {
      const pids: Record<string, number> = {};
      const killed: number[] = [];
      const child = stubChild({ pid: 93, stdout: erroringStdout(new Error("reader failed")) });
      const manager = new ServerLifecycleManager({
        servers: { survival: serverConfig(dir) },
        pidRegistry: registry(pids),
        spawn: () => child,
        portFree: async () => true,
        killPid: async (pid) => {
          killed.push(pid);
          child.resolveExit(137);
        },
      });

      const result = await manager.start("survival");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INTERNAL_ERROR");
        expect(result.details).toMatchObject({ serverId: "survival", cause: "Error: reader failed" });
      }
      expect(killed).toEqual([93]);
      expect(pids).toEqual({});
      expect(manager.snapshot("survival").state).toBe("FAILED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignores stdout cancel failure and releases reader lock after startup", async () => {
    const dir = tempDir();
    try {
      const stdout = cancelFailingStdout("Done!\n");
      const child = stubChild({ pid: 92, stdout: stdout.stream });
      const manager = new ServerLifecycleManager({
        servers: { survival: serverConfig(dir) },
        pidRegistry: registry({}),
        spawn: () => child,
        portFree: async () => true,
      });

      const result = await manager.start("survival");

      expect(result.ok).toBe(true);
      expect(stdout.cancelReason).toBeUndefined();
      expect(() => stdout.stream.getReader().releaseLock()).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("startup timeout keeps the timeout lastError after kill exit", async () => {
    const dir = tempDir();
    try {
      const child = stubChild({ pid: 97, stdout: "still loading\n" });
      const manager = new ServerLifecycleManager({
        servers: { survival: { ...serverConfig(dir), startupTimeout: 0.01 } },
        pidRegistry: registry({}),
        spawn: () => child,
        portFree: async () => true,
        killPid: async () => { child.resolveExit(137); },
      });

      const result = await manager.start("survival");
      await Bun.sleep(0);

      expect(result.ok).toBe(false);
      expect(manager.snapshot("survival").lastError).toBe("STARTUP_TIMEOUT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects non-executable Java path on POSIX", async () => {
    if (process.platform === "win32") return;

    const dir = tempDir();
    try {
      const javaPath = join(dir, "java-stub");
      writeFileSync(javaPath, "#!/bin/sh\n", "utf8");
      chmodSync(javaPath, 0o644);
      const manager = new ServerLifecycleManager({
        servers: { survival: { ...serverConfig(dir), javaPath } },
        pidRegistry: registry({}),
        portFree: async () => true,
      });

      const result = await manager.start("survival");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("JAVA_NOT_FOUND");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("finds Windows executables through PATHEXT", async () => {
    const dir = tempDir();
    const originalPath = process.env.PATH;
    const originalPathExt = process.env.PATHEXT;
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "java.exe"), "stub", "utf8");
      process.env.PATH = bin;
      process.env.PATHEXT = ".EXE;.CMD";
      Object.defineProperty(process, "platform", { value: "win32" });

      const child = stubChild({ pid: 98, stdout: "Done!\n" });
      const manager = new ServerLifecycleManager({
        servers: { survival: { ...serverConfig(dir), javaPath: "java" } },
        pidRegistry: registry({}),
        spawn: () => child,
        portFree: async () => true,
      });

      const result = await manager.start("survival");
      expect(result.ok).toBe(true);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (originalPathExt === undefined) delete process.env.PATHEXT;
      else process.env.PATHEXT = originalPathExt;
      if (originalPlatform !== undefined) Object.defineProperty(process, "platform", originalPlatform);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("marks non-intentional exit as FAILED and cleans PID", async () => {
    const dir = tempDir();
    try {
      const pids: Record<string, number> = {};
      const child = stubChild({ pid: 77, stdout: "Done!\n" });
      const manager = new ServerLifecycleManager({
        servers: { survival: serverConfig(dir) },
        pidRegistry: registry(pids),
        spawn: () => child,
        portFree: async () => true,
        killPid: async () => {},
      });

      await manager.start("survival");
      child.resolveExit(1);
      await Bun.sleep(0);

      expect(manager.snapshot("survival").state).toBe("FAILED");
      expect(pids).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("continues ingesting stdout after startup", async () => {
    const dir = tempDir();
    try {
      const stdout = controlledStdout();
      const child = stubChild({ pid: 76, stdout: stdout.stream });
      const logs = new ServerLogStore({ maxLinesPerSecond: 100 });
      const manager = new ServerLifecycleManager({
        servers: { survival: serverConfig(dir) },
        pidRegistry: registry({}),
        spawn: () => child,
        portFree: async () => true,
        logStore: logs,
      });

      const started = manager.start("survival");
      stdout.write("Preparing\nDone!\n");
      expect(await started).toMatchObject({ ok: true, state: "RUNNING" });
      stdout.write("after startup\n");
      await Bun.sleep(0);

      expect(logs.snapshot("survival").lines.map((line) => line.text)).toContain("after startup");
      stdout.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("default port check detects conflicts", async () => {
    const dir = tempDir();
    const socket = createServer();
    try {
      const port = await listen(socket);
      const manager = new ServerLifecycleManager({
        servers: { survival: { ...serverConfig(dir), serverPort: port } },
        pidRegistry: registry({}),
      });

      const result = await manager.start("survival");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PORT_CONFLICT");
    } finally {
      socket.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function serverConfig(dir: string): ServerConfig {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "server.jar"), "stub", "utf8");
  return {
    id: "survival",
    name: "Survival",
    path: dir,
    jarFile: "server.jar",
    ram: 1024,
    javaPath: process.execPath,
    serverPort: 25565,
    maxPlayers: 20,
    levelName: "world",
    startupTimeout: 1,
  };
}

function stubChild(options: { readonly pid: number; readonly stdout: string | ReadableStream<Uint8Array> }): ManagedChild & { resolveExit(code: number): void } {
  let resolveExit: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => { resolveExit = resolve; });
  return {
    pid: options.pid,
    stdout: typeof options.stdout === "string" ? new Blob([options.stdout]).stream() : options.stdout,
    exited,
    resolveExit,
    writeStdin() {},
  };
}

function controlledStdout(): { readonly stream: ReadableStream<Uint8Array>; write(text: string): void; close(): void } {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  return {
    stream: new ReadableStream<Uint8Array>({
      start(next) {
        controller = next;
      },
    }),
    write(text) {
      controller?.enqueue(new TextEncoder().encode(text));
    },
    close() {
      controller?.close();
    },
  };
}

function erroringStdout(error: unknown): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  });
}

function cancelFailingStdout(text: string): { readonly stream: ReadableStream<Uint8Array>; cancelReason: unknown } {
  let cancelReason: unknown;
  return {
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
      },
      cancel(reason) {
        cancelReason = reason;
        throw new Error("cancel failed");
      },
    }),
    get cancelReason() {
      return cancelReason;
    },
  };
}

function registry(pids: Record<string, number>) {
  return {
    read: async () => pids,
    set: async (key: string, pid: number) => { pids[key] = pid; },
    delete: async (key: string) => { delete pids[key]; },
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "explorers-cli-process-"));
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}
