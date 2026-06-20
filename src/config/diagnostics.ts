import type { ConfigDiagnostic } from "@infinityi/forge/config";

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly ConfigDiagnostic[] };

export function configIssue(
  path: string,
  reason: string,
  status: ConfigDiagnostic["status"] = "invalid",
): ConfigDiagnostic {
  return {
    path,
    envVar: pathToEnvVar(path),
    status,
    reason,
  };
}

function pathToEnvVar(path: string): string {
  if (path.length === 0) return "CONFIG";
  return path
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}
