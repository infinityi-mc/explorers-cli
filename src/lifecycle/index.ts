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
import { AGENT_COMPONENT, AgentExecutor } from "../agent";
import { CHAT_COMPONENT } from "../chat";
import type { LoadedRuntimeConfig, RuntimeOptions } from "../config";
import { LOG_COMPONENT, ServerLogStore } from "../log";
import { MENTION_COMPONENT, MentionRouter } from "../mention";
import {
  PERSISTENCE_COMPONENT,
  startPersistence,
  type PersistenceState,
} from "../persistence";
import { PROCESS_COMPONENT, ServerLifecycleManager } from "../process";
import { OperatorRouter, ROUTER_COMPONENT } from "../router";
import { TOOLS_COMPONENT, ToolSandboxBroker } from "../tools";
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
  let agentExecutor: AgentExecutor | undefined;
  let router: OperatorRouter | undefined;
  let processManager: ServerLifecycleManager | undefined;
  let toolBroker: ToolSandboxBroker | undefined;
  let logStore: ServerLogStore | undefined;
  let mentionRouter: MentionRouter | undefined;

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
    asComponent(LOG_COMPONENT, {
      start: () => {
        logStore = new ServerLogStore({ onLine: (line) => mentionRouter?.handleLine(line.serverId, line.text) });
      },
      stop: () => {
        logStore = undefined;
      },
    }),
    asComponent(PROCESS_COMPONENT, {
      start: () => {
        if (persistence === undefined) throw new Error("persistence must start before process manager");
        processManager = new ServerLifecycleManager({ servers: options.loaded.config.servers, pidRegistry: persistence.pidRegistry, logStore });
      },
      stop: () => {
        processManager = undefined;
      },
    }),
    asComponent(TOOLS_COMPONENT, {
      start: () => {
        if (persistence === undefined) throw new Error("persistence must start before tool broker");
        if (processManager === undefined) throw new Error("process manager must start before tool broker");
        toolBroker = new ToolSandboxBroker({
          config: options.loaded.config,
          lifecycle: processManager,
          auditLog: persistence.auditLog,
        });
      },
      stop: () => {
        toolBroker = undefined;
      },
    }),
    asComponent(CHAT_COMPONENT),
    asComponent(AGENT_COMPONENT, {
      start: () => {
        if (persistence === undefined) throw new Error("persistence must start before agent executor");
        if (toolBroker === undefined) throw new Error("tool broker must start before agent executor");
        try {
          agentExecutor = new AgentExecutor({
            config: options.loaded.config,
            sessionStore: persistence.sessionStore,
            toolsFor: (input) => toolBroker!.toolsFor(input),
          });
        } catch (error) {
          throw error instanceof Error ? error : new Error(String(error));
        }
      },
      stop: () => {
        agentExecutor = undefined;
      },
    }),
    asComponent(MENTION_COMPONENT, {
      start: () => {
        if (agentExecutor === undefined) throw new Error("agent executor must start before mention router");
        if (processManager === undefined) throw new Error("process manager must start before mention router");
        if (logStore === undefined) throw new Error("log store must start before mention router");
        mentionRouter = new MentionRouter({
          config: options.loaded.config,
          agentExecutor,
          sendCommand: (serverId, line) => processManager!.sendCommand(serverId, line),
          logSnapshot: (serverId, limit) => logStore!.snapshot(serverId, limit),
        });
      },
      stop: () => {
        mentionRouter = undefined;
      },
    }),
    asComponent(ROUTER_COMPONENT, {
      start: () => {
        router = new OperatorRouter({
          runtimeMode: options.runtime.mode,
          sessionStore: agentExecutor,
          serverLifecycle: processManager,
          agentExecutor,
        });
      },
      stop: () => {
        router = undefined;
      },
    }),
    asComponent("tui", {
      start: async () => {
        stopTui = await options.startTui(
          createAppViewModel(options.loaded, options.runtime, {
            routeCommand: (command) => {
              if (router === undefined) throw new Error("operator router is not started");
              return router.route(command);
            },
          }),
        );
      },
      stop: async () => {
        stopTui?.();
        stopTui = undefined;
      },
    }),
  ];
}
