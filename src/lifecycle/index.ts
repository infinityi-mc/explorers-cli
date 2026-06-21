import {
  asComponent,
  boot,
  type Application,
  type BootOptions,
  type Component,
  type ExitFn,
  type Logger,
} from "@infinityi/forge/lifecycle";
import { dirname, join } from "node:path";
import { AGENT_COMPONENT } from "../agent";
import { CHAT_COMPONENT } from "../chat";
import type { LoadedRuntimeConfig, RuntimeOptions } from "../config";
import { LOG_COMPONENT } from "../log";
import {
  PERSISTENCE_COMPONENT,
  startPersistence,
  type PersistenceState,
} from "../persistence";
import { PROCESS_COMPONENT } from "../process";
import { ROUTER_COMPONENT } from "../router";
import { TOOLS_COMPONENT } from "../tools";
import { createAppViewModel, type StartTui, type StopTui } from "../tui";

export interface BootExplorersOptions {
  readonly loaded: LoadedRuntimeConfig;
  readonly runtime: RuntimeOptions;
  readonly logger?: Logger;
  readonly startTui: StartTui;
  readonly installSignals?: boolean;
  readonly exit?: ExitFn;
  readonly startTimeout?: number;
  readonly shutdownTimeout?: number;
  readonly dataDir?: string;
}

export async function bootExplorers(
  options: BootExplorersOptions,
): Promise<Application> {
  return boot({
    components: createFoundationComponents(options),
    logger: options.logger,
    shutdownTimeout: options.shutdownTimeout ?? 10_000,
    startTimeout: options.startTimeout ?? options.shutdownTimeout ?? 10_000,
    installSignals: options.installSignals,
    exit: options.exit,
  } satisfies BootOptions);
}

export function createFoundationComponents(
  options: BootExplorersOptions,
): Component[] {
  let stopTui: StopTui | undefined;
  let persistence: PersistenceState | undefined;

  return [
    asComponent("config", {
      start: () => {
        options.logger?.info("config.loaded", {
          configPath: options.loaded.configPath,
          configExisted: options.loaded.configExisted,
          servers: Object.keys(options.loaded.config.servers).length,
          agents: Object.keys(options.loaded.config.agents).length,
        });
      },
    }),
    asComponent("telemetry"),
    asComponent(PERSISTENCE_COMPONENT, {
      start: async () => {
        persistence = await startPersistence({
          dataDir: options.dataDir ?? join(dirname(options.loaded.configPath), "data"),
          logger: options.logger,
        });
      },
      stop: async () => {
        await persistence?.stop();
        persistence = undefined;
      },
    }),
    asComponent(ROUTER_COMPONENT),
    asComponent(PROCESS_COMPONENT),
    asComponent(LOG_COMPONENT),
    asComponent(CHAT_COMPONENT),
    asComponent(AGENT_COMPONENT),
    asComponent(TOOLS_COMPONENT),
    asComponent("tui", {
      start: async () => {
        stopTui = await options.startTui(
          createAppViewModel(options.loaded, options.runtime),
        );
      },
      stop: async () => {
        stopTui?.();
        stopTui = undefined;
      },
    }),
  ];
}
