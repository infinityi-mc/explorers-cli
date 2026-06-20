import type { Application } from "@infinityi/forge/lifecycle";
import { dirname, join } from "node:path";
import {
  formatRuntimeConfigDiagnostics,
  loadRuntimeConfig,
  parseRuntimeOptions,
  type RuntimeOptions,
} from "./config";
import { bootExplorers } from "./lifecycle";
import { createAppTelemetry, installCrashReporter } from "./telemetry";
import { startTui, type StartTui } from "./tui";

export type RunCliResult =
  | { readonly kind: "exit"; readonly code: number }
  | { readonly kind: "running"; readonly app: Application };

export interface RunCliOptions {
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly stderr?: Pick<NodeJS.WriteStream, "write">;
  readonly startTui?: StartTui;
  readonly installSignals?: boolean;
  readonly exit?: (code: number) => never;
  readonly logDir?: string;
}

export async function runCli(options: RunCliOptions = {}): Promise<RunCliResult> {
  const argv = options.argv ?? process.argv.slice(2);
  const runtime = parseRuntimeOptions(argv);
  if (!runtime.ok) return fail(runtime.diagnostics, options.stderr);

  const loaded = await loadRuntimeConfig({
    configPath: runtime.value.configPath,
    argv,
    env: options.env,
  });
  if (!loaded.ok) return fail(loaded.diagnostics, options.stderr);

  if (runtime.value.mode === "validate-config") {
    options.stdout?.write(`Config valid: ${loaded.value.configPath}\n`);
    return { kind: "exit", code: 0 };
  }

  const telemetry = createAppTelemetry(loaded.value.config, {
    logDir: options.logDir ?? join(dirname(loaded.value.configPath), "logs"),
  });
  const disposeCrashReporter = installCrashReporter({
    directory: options.logDir ?? join(dirname(loaded.value.configPath), "logs"),
  });

  try {
    const app = await bootExplorers({
      loaded: loaded.value,
      runtime: runtime.value,
      logger: telemetry.logger,
      startTui: options.startTui ?? startTui,
      installSignals: options.installSignals,
      exit: options.exit,
    });
    const done = app.done.finally(async () => {
      disposeCrashReporter();
      await telemetry.shutdown();
    });
    return {
      kind: "running",
      app: {
        components: app.components,
        logger: app.logger,
        get ready() {
          return app.ready;
        },
        async stop(reason?: string) {
          await app.stop(reason);
          await done;
        },
        done,
      },
    };
  } catch (error) {
    disposeCrashReporter();
    await telemetry.shutdown();
    options.stderr?.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return { kind: "exit", code: 1 };
  }
}

function fail(
  diagnostics: readonly Parameters<typeof formatRuntimeConfigDiagnostics>[0][number][],
  stderr: Pick<NodeJS.WriteStream, "write"> | undefined,
): RunCliResult {
  stderr?.write(formatRuntimeConfigDiagnostics(diagnostics));
  return { kind: "exit", code: 1 };
}

export type { RuntimeOptions };
