import { initTelemetry } from "@infinityi/forge/telemetry";
import { createLog, type Logger } from "@infinityi/forge/telemetry/log";
import { nullMeterExporter } from "@infinityi/forge/telemetry/meter/exporters/null";
import { nullSpanExporter } from "@infinityi/forge/telemetry/trace/exporters/null";
import { redact, serialize } from "@infinityi/forge/telemetry/log/middleware";
import { join } from "node:path";
import type { RuntimeConfig } from "../config";
import { writeCrashReport, installCrashReporter } from "./crash";
import { defaultRedactionPatterns, redactText, redactValue } from "./redaction";
import { rotatingFileExporter } from "./rotating-file-writer";

export interface AppTelemetry {
  readonly logger: Logger;
  readonly shutdown: () => Promise<void>;
}

export interface CreateAppTelemetryOptions {
  readonly logDir?: string;
}

export function createAppTelemetry(
  config: RuntimeConfig,
  options: CreateAppTelemetryOptions = {},
): AppTelemetry {
  const logDir = options.logDir ?? "logs";
  const exporter = rotatingFileExporter({
    filePath: join(logDir, "explorers-cli.log"),
    rotationBytes: config.logging.rotationBytes,
  });
  const logger = createLog({
    exporter,
    level: config.logging.level,
    attributes: { service: "explorers-cli" },
    middleware: [
      redact({ patterns: defaultRedactionPatterns }),
      serialize(),
    ],
  });

  const telemetry = initTelemetry({
    resource: { serviceName: "explorers-cli", serviceVersion: "1.0.0" },
    // ponytail: PR1 proves the telemetry seam; remote exporters wire in with the first real signal use.
    meter: { exporter: nullMeterExporter() },
    trace: { exporter: nullSpanExporter(), processor: "simple" },
  });

  return {
    logger,
    async shutdown() {
      await logger.shutdown?.();
      await telemetry.shutdown();
    },
  };
}

export {
  defaultRedactionPatterns,
  installCrashReporter,
  redactText,
  redactValue,
  writeCrashReport,
};
