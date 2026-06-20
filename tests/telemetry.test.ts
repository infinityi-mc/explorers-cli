import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactText, redactValue, writeCrashReport } from "../src/telemetry";
import { rotatingFileExporter } from "../src/telemetry/rotating-file-writer";

describe("telemetry redaction", () => {
  test("redacts common secret text", () => {
    const redacted = redactText("apiKey=provider-secret Bearer token123 admin@example.com");
    expect(redacted).not.toContain("provider-secret");
    expect(redacted).not.toContain("token123");
    expect(redacted).not.toContain("admin@example.com");
    expect(redacted).toContain("[REDACTED]");
  });

  test("redacts quoted and multi-segment secret assignments", () => {
    expect(redactText('apiKey="hunter2"')).toBe("apiKey=[REDACTED]");
    expect(redactText("secret : foo : bar")).toBe("secret : [REDACTED]");
  });

  test("redacts secret object keys", () => {
    expect(redactValue({ apiKey: "provider-secret", nested: { password: "pw" } })).toEqual({
      apiKey: "[REDACTED]",
      nested: { password: "[REDACTED]" },
    });
  });

  test("writes redacted crash reports", () => {
    const dir = mkdtempSync(join(tmpdir(), "explorers-cli-"));
    try {
      const file = writeCrashReport(new Error("password=hunter2"), {
        directory: dir,
        now: () => new Date("2026-06-20T00:00:00.000Z"),
      });
      const contents = readFileSync(file, "utf8");
      expect(contents).not.toContain("hunter2");
      expect(contents).toContain("[REDACTED]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rotating file maxFiles includes the current file", () => {
    const dir = mkdtempSync(join(tmpdir(), "explorers-cli-"));
    const filePath = join(dir, "explorers-cli.log");
    const exporter = rotatingFileExporter({ filePath, rotationBytes: 1, maxFiles: 2 });

    try {
      exporter.export(logRecord("first"));
      exporter.export(logRecord("second"));
      exporter.export(logRecord("third"));

      expect(existsSync(filePath)).toBe(true);
      expect(existsSync(`${filePath}.1`)).toBe(true);
      expect(existsSync(`${filePath}.2`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rotating file maxFiles=1 keeps only current file", () => {
    const dir = mkdtempSync(join(tmpdir(), "explorers-cli-"));
    const filePath = join(dir, "explorers-cli.log");
    const exporter = rotatingFileExporter({ filePath, rotationBytes: 1, maxFiles: 1 });

    try {
      exporter.export(logRecord("first"));
      exporter.export(logRecord("second"));

      expect(existsSync(filePath)).toBe(true);
      expect(existsSync(`${filePath}.1`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function logRecord(message: string) {
  return {
    level: "info" as const,
    message,
    timestamp: new Date("2026-06-20T00:00:00.000Z"),
    attributes: {},
  };
}
