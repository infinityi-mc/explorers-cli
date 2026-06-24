import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { ConfigDiagnostic } from "@infinityi/forge/config";
import type { ServerState } from "../domain";
import { configIssue } from "./diagnostics";
import { loadRuntimeConfig, type LoadedRuntimeConfig } from "./load";
import { rebuildRuntimeIndexes, type RuntimeIndexes } from "./indexes";
import type { RuntimeConfig, RuntimeOptions } from "./types";

export type ReloadOutcome =
  | {
    readonly ok: true;
    readonly loaded: LoadedRuntimeConfig;
    readonly changedKeys: readonly string[];
    readonly pendingRestart: ReadonlySet<string>;
    readonly indexes: RuntimeIndexes;
    readonly durationMs: number;
  }
  | {
    readonly ok: false;
    readonly diagnostics: readonly ConfigDiagnostic[];
    readonly kept: LoadedRuntimeConfig;
    readonly durationMs: number;
  };

export interface HotReloadServiceOptions {
  readonly loaded: LoadedRuntimeConfig;
  readonly runtime: RuntimeOptions;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly getServerState: (serverId: string) => ServerState;
  readonly debounceMs?: number;
  readonly onReload?: (outcome: ReloadOutcome) => void;
}

const PROCESS_FIELDS = new Set(["path", "serverPort", "ram", "jarFile", "javaPath", "startupTimeout"]);

export class HotReloadService {
  private current: LoadedRuntimeConfig;
  private watcher: FSWatcher | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastOutcome: ReloadOutcome | undefined;

  constructor(private readonly options: HotReloadServiceOptions) {
    this.current = options.loaded;
  }

  get snapshot(): LoadedRuntimeConfig {
    return this.current;
  }

  get outcome(): ReloadOutcome | undefined {
    return this.lastOutcome;
  }

  start(): void {
    const watchedName = basename(this.options.runtime.configPath);
    this.watcher = watch(dirname(this.options.runtime.configPath), { persistent: false }, (_event, filename) => {
      if (filename === null || filename === watchedName) this.debounce();
    });
  }

  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.watcher?.close();
    this.timer = undefined;
    this.watcher = undefined;
  }

  async reloadNow(): Promise<ReloadOutcome> {
    const outcome = await tryReloadConfig({
      current: this.current,
      runtime: this.options.runtime,
      env: this.options.env,
      getServerState: this.options.getServerState,
    });
    if (outcome.ok) this.current = outcome.loaded;
    this.lastOutcome = outcome;
    this.options.onReload?.(outcome);
    return outcome;
  }

  private debounce(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.reloadNow(), this.options.debounceMs ?? 200);
  }
}

export async function tryReloadConfig(options: {
  readonly current: LoadedRuntimeConfig;
  readonly runtime: RuntimeOptions;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly getServerState: (serverId: string) => ServerState;
}): Promise<ReloadOutcome> {
  const started = Date.now();
  const loaded = await loadRuntimeConfig({
    configPath: options.runtime.configPath,
    argv: options.runtime.argv,
    env: options.env,
  });
  if (!loaded.ok) return rejected(loaded.diagnostics, options.current, started);
  if (!loaded.value.configExisted) return rejected([configIssue("config.yaml", "Config file is missing; retaining last known good config.")], options.current, started);

  const removal = removedRunningServer(options.current.config, loaded.value.config, options.getServerState);
  if (removal !== undefined) {
    return rejected([configIssue("servers", `Cannot remove ${removal} while it is ${options.getServerState(removal)}.`)], options.current, started);
  }

  const changedKeys = diffRuntimeConfig(options.current.config, loaded.value.config);
  const pendingRestart = pendingRestartServers(changedKeys, options.getServerState);
  return {
    ok: true,
    loaded: loaded.value,
    changedKeys,
    pendingRestart,
    indexes: rebuildRuntimeIndexes(loaded.value.config),
    durationMs: Date.now() - started,
  };
}

export function diffRuntimeConfig(current: RuntimeConfig, next: RuntimeConfig): readonly string[] {
  const out: string[] = [];
  diffValue("", current, next, out);
  return out;
}

function removedRunningServer(
  current: RuntimeConfig,
  next: RuntimeConfig,
  getServerState: (serverId: string) => ServerState,
): string | undefined {
  for (const serverId of Object.keys(current.servers)) {
    if (next.servers[serverId] !== undefined) continue;
    const state = getServerState(serverId);
    if (state === "RUNNING" || state === "STARTING") return serverId;
  }
  return undefined;
}

function pendingRestartServers(changedKeys: readonly string[], getServerState: (serverId: string) => ServerState): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of changedKeys) {
    const [, serverId, field] = key.split(".");
    if (!key.startsWith("servers.") || serverId === undefined || field === undefined || !PROCESS_FIELDS.has(field)) continue;
    const state = getServerState(serverId);
    if (state === "RUNNING" || state === "STARTING") out.add(serverId);
  }
  return out;
}

function diffValue(path: string, current: unknown, next: unknown, out: string[]): void {
  if (Object.is(current, next)) return;
  if (!isRecord(current) || !isRecord(next)) {
    out.push(path);
    return;
  }
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
    diffValue(path.length === 0 ? key : `${path}.${key}`, current[key], next[key], out);
  }
}

function rejected(diagnostics: readonly ConfigDiagnostic[], kept: LoadedRuntimeConfig, started: number): ReloadOutcome {
  return { ok: false, diagnostics, kept, durationMs: Date.now() - started };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
