import type { LoadedRuntimeConfig, RuntimeOptions } from "../config";
import type { ReloadOutcome } from "../config/hot-reload";
import type { ServerRuntimeSnapshot } from "../process";
import type { ServerLogStore } from "../log";
import type { OperatorResponse, ParsedCommand } from "../router";

export interface AppViewModel {
  readonly title: string;
  readonly mode: string;
  readonly configPath: string;
  readonly configStatus: string;
  readonly serverCount: number;
  readonly agentCount: number;
  readonly providerCount: number;
  readonly servers: readonly ServerPanelItem[];
  readonly logs: readonly string[];
  readonly banner?: string;
  readonly routeCommand?: (command: ParsedCommand) => Promise<OperatorResponse>;
}

export interface ServerPanelItem {
  readonly id: string;
  readonly state: string;
  readonly pid?: number;
  readonly pendingRestart: boolean;
  readonly bufferBytes: number;
  readonly bufferCapacityBytes: number;
  readonly dropped: number;
  readonly evicted: number;
}

export function createAppViewModel(
  loaded: LoadedRuntimeConfig,
  runtime: RuntimeOptions,
  state?: {
    readonly snapshot?: (serverId: string) => ServerRuntimeSnapshot;
    readonly logStore?: Pick<ServerLogStore, "snapshot">;
    readonly pendingRestart?: ReadonlySet<string>;
    readonly reloadOutcome?: ReloadOutcome;
    readonly routeCommand?: (command: ParsedCommand) => Promise<OperatorResponse>;
  },
): AppViewModel {
  const serverIds = Object.keys(loaded.config.servers);
  const selectedServer = serverIds[0];
  return {
    title: "explorers-cli",
    mode: runtime.mode,
    configPath: loaded.configPath,
    configStatus: loaded.configExisted ? "loaded" : "defaults (no config.yaml)",
    serverCount: Object.keys(loaded.config.servers).length,
    agentCount: Object.keys(loaded.config.agents).length,
    providerCount: Object.keys(loaded.config.providers).length,
    servers: serverIds.map((id) => serverItem(id, state)),
    logs: selectedServer === undefined ? [] : state?.logStore?.snapshot(selectedServer, 12)?.lines.map((line) => line.text) ?? [],
    banner: reloadBanner(state?.reloadOutcome),
    routeCommand: state?.routeCommand,
  };
}

function serverItem(
  id: string,
  state: Parameters<typeof createAppViewModel>[2],
): ServerPanelItem {
  const runtime = state?.snapshot?.(id) ?? { serverId: id, state: "STOPPED" as const };
  const logs = state?.logStore?.snapshot(id, 0);
  return {
    id,
    state: runtime.state,
    pid: runtime.pid,
    pendingRestart: state?.pendingRestart?.has(id) ?? false,
    bufferBytes: logs?.bytes ?? 0,
    bufferCapacityBytes: logs?.capacityBytes ?? 16 * 1024 * 1024,
    dropped: (logs?.droppedRateLimited ?? 0) + (logs?.droppedBufferFull ?? 0),
    evicted: logs?.evicted ?? 0,
  };
}

function reloadBanner(outcome: ReloadOutcome | undefined): string | undefined {
  if (outcome === undefined) return undefined;
  if (outcome.ok) return `Config reloaded: ${outcome.changedKeys.length} changes`;
  return `Hot reload rejected: ${outcome.diagnostics.map((diagnostic) => diagnostic.reason).join("; ")}`;
}
