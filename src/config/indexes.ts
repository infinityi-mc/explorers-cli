import type { AgentConfig, PlayerConfig, ProviderConfig, RuntimeConfig } from "./types";

export interface RuntimeIndexes {
  readonly permissions: ReadonlyMap<string, ReadonlyMap<string, PlayerConfig>>;
  readonly agents: ReadonlyMap<string, AgentConfig>;
  readonly providers: ReadonlyMap<string, ProviderConfig>;
  readonly toolPolicyVersion: number;
}

let toolPolicyVersion = 0;

export function rebuildRuntimeIndexes(config: RuntimeConfig): RuntimeIndexes {
  const permissions = new Map<string, ReadonlyMap<string, PlayerConfig>>();
  for (const [serverId, serverPermissions] of Object.entries(config.permissions)) {
    permissions.set(serverId, new Map(serverPermissions.players.map((player) => [player.name.toLowerCase(), player])));
  }

  return {
    permissions,
    agents: new Map(Object.entries(config.agents)),
    providers: new Map(Object.entries(config.providers)),
    // ponytail: PHASE-009 builds real tool policies; version gives hot-reload a rebuild seam now.
    toolPolicyVersion: ++toolPolicyVersion,
  };
}
