import { existsSync, mkdirSync, renameSync, rmSync, statSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LogExporter, LogRecord } from "@infinityi/forge/telemetry/log";

export interface RotatingFileExporterOptions {
  readonly filePath: string;
  readonly rotationBytes: number;
  readonly maxFiles?: number;
}

export function rotatingFileExporter(options: RotatingFileExporterOptions): LogExporter {
  const maxFiles = options.maxFiles ?? 5;
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new Error("maxFiles must be an integer greater than or equal to 1.");
  }
  mkdirSync(dirname(options.filePath), { recursive: true });

  return {
    export(record) {
      const line = `${JSON.stringify(formatRecord(record))}\n`;
      rotateIfNeeded(options.filePath, byteLength(line), options.rotationBytes, maxFiles);
      appendFileSync(options.filePath, line, "utf8");
    },
    async flush() {},
    async shutdown() {},
  };
}

function formatRecord(record: LogRecord): Record<string, unknown> {
  return {
    timestamp: record.timestamp.toISOString(),
    level: record.level.toUpperCase(),
    service: "explorers-cli",
    trace_id: record.context?.traceId ?? null,
    span_id: record.context?.spanId ?? null,
    request_id: record.context?.baggage?.request_id ?? null,
    channel: "app",
    serverId: null,
    agentId: null,
    message: record.message,
    ...record.attributes,
  };
}

function rotateIfNeeded(
  filePath: string,
  nextBytes: number,
  rotationBytes: number,
  maxFiles: number,
): void {
  if (!existsSync(filePath)) return;
  if (statSync(filePath).size + nextBytes <= rotationBytes) return;

  if (maxFiles === 1) {
    rmSync(filePath, { force: true });
    return;
  }

  for (let i = maxFiles - 2; i >= 1; i--) {
    const from = `${filePath}.${i}`;
    const to = `${filePath}.${i + 1}`;
    if (!existsSync(from)) continue;
    renameSync(from, to);
  }
  renameSync(filePath, `${filePath}.1`);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
