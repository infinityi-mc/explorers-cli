import type { ConfigSource } from "@infinityi/forge/config";
import { parse } from "yaml";
import { configIssue, type Result } from "./diagnostics";

export async function readYamlConfig(path: string): Promise<
  Result<{ readonly value: unknown; readonly existed: boolean }>
> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { ok: true, value: { value: {}, existed: false } };
  }

  try {
    const text = await file.text();
    return parseYamlConfig(text);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [configIssue("config.yaml", errorMessage(error))],
    };
  }
}

export function parseYamlConfig(
  text: string,
): Result<{ readonly value: unknown; readonly existed: boolean }> {
  try {
    return { ok: true, value: { value: parse(text) ?? {}, existed: true } };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [configIssue("config.yaml", errorMessage(error))],
    };
  }
}

export function yamlConfigSource(root: unknown): ConfigSource {
  return {
    name: "config.yaml",
    get({ path }) {
      return sourceValue(readPath(root, path));
    },
  };
}

export function envConfigSource(env: Readonly<Record<string, string | undefined>>): ConfigSource {
  return {
    name: "env",
    get({ envVar }) {
      return env[envVar];
    },
  };
}

function readPath(root: unknown, path: string): unknown {
  if (path.length === 0) return root;
  let cursor = root;
  for (const segment of path.split(".")) {
    if (!isRecord(cursor) && !Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function sourceValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
