import { configIssue, type Result } from "./diagnostics";
import type { RuntimeOptions } from "./types";

export function parseRuntimeOptions(
  argv: readonly string[] = process.argv.slice(2),
): Result<RuntimeOptions> {
  let configPath = "config.yaml";
  let readOnly = false;
  let validateConfig = false;
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--read-only") {
      readOnly = true;
      continue;
    }
    if (arg === "--validate-config") {
      validateConfig = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--config") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return {
          ok: false,
          diagnostics: [
            configIssue("config", "--config requires a file path."),
          ],
        };
      }
      configPath = value;
      i++;
      continue;
    }
    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (value.length === 0) {
        return {
          ok: false,
          diagnostics: [
            configIssue("config", "--config requires a file path."),
          ],
        };
      }
      configPath = value;
    }
  }

  return {
    ok: true,
    value: {
      mode: validateConfig
        ? "validate-config"
        : readOnly
          ? "read-only"
          : "normal",
      configPath,
      verbose,
      argv,
    },
  };
}
