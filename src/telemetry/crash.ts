import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactValue } from "./redaction";

export interface CrashReportOptions {
  readonly directory: string;
  readonly now?: () => Date;
}

export function writeCrashReport(
  error: unknown,
  options: CrashReportOptions,
): string {
  mkdirSync(options.directory, { recursive: true });
  const timestamp = (options.now?.() ?? new Date())
    .toISOString()
    .replace(/[:.]/g, "-");
  const filePath = join(options.directory, `crash-${timestamp}.json`);
  const payload = redactValue({
    timestamp,
    service: "explorers-cli",
    error: error instanceof Error ? error : new Error(String(error)),
  });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

export function installCrashReporter(options: CrashReportOptions): () => void {
  const handler = (error: unknown) => {
    writeCrashReport(error, options);
    process.exit(1);
  };
  const rejectionHandler = (reason: unknown) => handler(reason);
  process.on("uncaughtException", handler);
  process.on("unhandledRejection", rejectionHandler);
  return () => {
    process.off("uncaughtException", handler);
    process.off("unhandledRejection", rejectionHandler);
  };
}
