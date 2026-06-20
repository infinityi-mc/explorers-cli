import type { LoadedRuntimeConfig, RuntimeOptions } from "../config";

export interface AppViewModel {
  readonly title: string;
  readonly mode: string;
  readonly configPath: string;
  readonly configStatus: string;
  readonly serverCount: number;
  readonly agentCount: number;
  readonly providerCount: number;
  readonly panels: readonly string[];
}

export function createAppViewModel(
  loaded: LoadedRuntimeConfig,
  runtime: RuntimeOptions,
): AppViewModel {
  return {
    title: "explorers-cli",
    mode: runtime.mode,
    configPath: loaded.configPath,
    configStatus: loaded.configExisted ? "loaded" : "defaults (no config.yaml)",
    serverCount: Object.keys(loaded.config.servers).length,
    agentCount: Object.keys(loaded.config.agents).length,
    providerCount: Object.keys(loaded.config.providers).length,
    panels: ["Servers", "Logs", "Chat", "Commands"],
  };
}
