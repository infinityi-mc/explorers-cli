import {
  ConfigValidationError,
  cliSource,
  defineConfig,
  formatDiagnostics,
  t,
  type ConfigDiagnostic,
  type Infer,
} from "@infinityi/forge/config";
import { configIssue, type Result } from "./diagnostics";
import type {
  AgentConfig,
  LoggingLevel,
  PlayerConfig,
  ProviderConfig,
  ProviderType,
  RuntimeConfig,
  ServerConfig,
  ServerPermissions,
} from "./types";
import { envConfigSource, readYamlConfig, yamlConfigSource } from "./yaml-source";

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
const ALIAS_PATTERN = /^[a-zA-Z0-9_-]{2,}$/;
const PLAYER_NAME_PATTERN = /^[a-zA-Z0-9_]{1,16}$/;
const ENV_REFERENCE_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const ISO_DURATION_PATTERN = /^P(?!$)[0-9YMWDTHMS.]+$/;
const PROVIDER_TYPES = new Set<ProviderType>([
  "openai",
  "anthropic",
  "openai-compatible",
]);

const rawConfigSchema = {
  schemaVersion: t.number.int.default(1),
  servers: t.json<unknown>().default([]),
  providers: t.json<unknown>().default([]),
  agents: t.json<unknown>().default([]),
  permissions: t.json<unknown>().default({}),
  featureFlags: {
    audioplayer: t.boolean.default(false),
  },
  telemetry: {
    enabled: t.boolean.default(false),
    endpoint: t.string.url.optional(),
  },
  logging: {
    level: t.enum(["trace", "debug", "info"] as const).default("info"),
    rotationBytes: t.number.int.default(50 * 1024 * 1024),
  },
  sessionRetention: t.string.default("P30D"),
} as const;

type RawConfig = Infer<typeof rawConfigSchema>;

export interface LoadRuntimeConfigOptions {
  readonly configPath: string;
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface LoadedRuntimeConfig {
  readonly config: RuntimeConfig;
  readonly configPath: string;
  readonly configExisted: boolean;
}

export async function loadRuntimeConfig(
  options: LoadRuntimeConfigOptions,
): Promise<Result<LoadedRuntimeConfig>> {
  const env = options.env ?? Bun.env;
  const yaml = await readYamlConfig(options.configPath);
  if (!yaml.ok) return yaml;

  if (!isRecord(yaml.value.value)) {
    return {
      ok: false,
      diagnostics: [configIssue("config.yaml", "Config root must be a YAML object.")],
    };
  }

  let raw: RawConfig;
  try {
    raw = defineConfig(rawConfigSchema, {
      sources: [
        yamlConfigSource(yaml.value.value),
        envConfigSource(env),
        cliSource({ argv: options.argv ?? [] }),
      ],
      throwOnError: true,
      redactReceived: true,
    });
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return { ok: false, diagnostics: error.issues };
    }
    return {
      ok: false,
      diagnostics: [configIssue("config", errorMessage(error))],
    };
  }

  const normalized = normalizeRuntimeConfig(raw, env);
  if (!normalized.ok) return normalized;

  return {
    ok: true,
    value: {
      config: normalized.value,
      configPath: options.configPath,
      configExisted: yaml.value.existed,
    },
  };
}

export function formatRuntimeConfigDiagnostics(
  diagnostics: readonly ConfigDiagnostic[],
): string {
  return formatDiagnostics(diagnostics, { color: false });
}

function normalizeRuntimeConfig(
  raw: RawConfig,
  env: Readonly<Record<string, string | undefined>>,
): Result<RuntimeConfig> {
  const issues: ConfigDiagnostic[] = [];

  if (raw.schemaVersion !== 1) {
    issues.push(configIssue("schemaVersion", "Only schemaVersion 1 is supported."));
  }

  const servers = normalizeServers(raw.servers, issues);
  const providers = normalizeProviders(raw.providers, env, issues);
  const agents = normalizeAgents(raw.agents, providers, issues);
  const permissions = normalizePermissions(raw.permissions, servers, agents, issues);

  if (!ISO_DURATION_PATTERN.test(raw.sessionRetention)) {
    issues.push(configIssue("sessionRetention", "Must be an ISO 8601 duration, e.g. P30D."));
  }
  if (raw.logging.rotationBytes < 1) {
    issues.push(configIssue("logging.rotationBytes", "Must be at least 1 byte."));
  }

  if (issues.length > 0) {
    return { ok: false, diagnostics: issues };
  }

  return {
    ok: true,
    value: deepFreeze({
      schemaVersion: raw.schemaVersion,
      servers,
      providers,
      agents,
      permissions,
      featureFlags: { audioplayer: raw.featureFlags.audioplayer },
      telemetry: raw.telemetry.endpoint
        ? { enabled: raw.telemetry.enabled, endpoint: raw.telemetry.endpoint }
        : { enabled: raw.telemetry.enabled },
      logging: {
        level: raw.logging.level as LoggingLevel,
        rotationBytes: raw.logging.rotationBytes,
      },
      sessionRetention: raw.sessionRetention,
    }),
  };
}

function normalizeServers(
  value: unknown,
  issues: ConfigDiagnostic[],
): Record<string, ServerConfig> {
  const out: Record<string, ServerConfig> = {};
  const names = new Set<string>();
  const entries = configEntries(value, "servers", "id", issues);

  if (entries.length > 10) {
    issues.push(configIssue("servers", "At most 10 servers are allowed."));
  }

  for (const entry of entries) {
    const path = entry.path;
    const id = idField(entry, path, issues);
    const name = stringField(entry.value, "name", `${path}.name`, issues);
    const serverPath = stringField(entry.value, "path", `${path}.path`, issues);
    const jarFile = stringField(entry.value, "jarFile", `${path}.jarFile`, issues);
    const javaPath = stringField(entry.value, "javaPath", `${path}.javaPath`, issues);
    const serverPort = numberField(entry.value, "serverPort", `${path}.serverPort`, issues, {
      min: 1024,
      max: 65535,
    });
    const levelName = stringField(entry.value, "levelName", `${path}.levelName`, issues);
    const ram = numberField(entry.value, "ram", `${path}.ram`, issues, {
      min: 512,
      max: 32768,
      defaultValue: 1024,
    });
    const maxPlayers = numberField(entry.value, "maxPlayers", `${path}.maxPlayers`, issues, {
      min: 1,
      max: 100,
      defaultValue: 20,
    });
    const startupTimeout = numberField(
      entry.value,
      "startupTimeout",
      `${path}.startupTimeout`,
      issues,
      { min: 30, max: 600, defaultValue: 120 },
    );

    if (name !== undefined) {
      if (names.has(name)) issues.push(configIssue(`${path}.name`, "Server names must be unique."));
      names.add(name);
    }

    if (
      id !== undefined &&
      name !== undefined &&
      serverPath !== undefined &&
      jarFile !== undefined &&
      javaPath !== undefined &&
      serverPort !== undefined &&
      levelName !== undefined &&
      ram !== undefined &&
      maxPlayers !== undefined &&
      startupTimeout !== undefined
    ) {
      out[id] = {
        id,
        name,
        path: serverPath,
        jarFile,
        ram,
        javaPath,
        serverPort,
        maxPlayers,
        levelName,
        startupTimeout,
      };
    }
  }

  return out;
}

function normalizeProviders(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
  issues: ConfigDiagnostic[],
): Record<string, ProviderConfig> {
  const out: Record<string, ProviderConfig> = {};
  for (const entry of configEntries(value, "providers", "name", issues)) {
    const path = entry.path;
    const name = namedField(entry, "name", path, issues);
    const type = enumField(entry.value, "type", `${path}.type`, PROVIDER_TYPES, issues);
    const model = stringField(entry.value, "model", `${path}.model`, issues);
    const apiKey = secretEnvField(entry.value, "apiKey", `${path}.apiKey`, env, issues);
    const baseUrl = optionalStringField(entry.value, "baseUrl", `${path}.baseUrl`, issues);
    if (baseUrl !== undefined) validateUrl(baseUrl, `${path}.baseUrl`, issues);

    if (name !== undefined && type !== undefined && model !== undefined && apiKey !== undefined) {
      out[name] = baseUrl === undefined
        ? { name, type, model, apiKey }
        : { name, type, baseUrl, model, apiKey };
    }
  }
  return out;
}

function normalizeAgents(
  value: unknown,
  providers: Readonly<Record<string, ProviderConfig>>,
  issues: ConfigDiagnostic[],
): Record<string, AgentConfig> {
  const out: Record<string, AgentConfig> = {};
  const aliases = new Set<string>();

  for (const entry of configEntries(value, "agents", "id", issues)) {
    const path = entry.path;
    const id = idField(entry, path, issues);
    const name = stringField(entry.value, "name", `${path}.name`, issues);
    const alias = stringField(entry.value, "alias", `${path}.alias`, issues, ALIAS_PATTERN);
    const provider = stringField(entry.value, "provider", `${path}.provider`, issues);
    const systemPrompt = stringField(entry.value, "systemPrompt", `${path}.systemPrompt`, issues);
    const tools = stringArrayField(entry.value, "tools", `${path}.tools`, issues, []);
    const commandAllowlist = stringArrayField(
      entry.value,
      "commandAllowlist",
      `${path}.commandAllowlist`,
      issues,
      [],
    );
    const timeout = numberField(entry.value, "timeout", `${path}.timeout`, issues, {
      min: 10,
      max: 600,
      defaultValue: 120,
    });
    const ingameMessageWindow = numberField(
      entry.value,
      "ingameMessageWindow",
      `${path}.ingameMessageWindow`,
      issues,
      { min: 0, max: 50, defaultValue: 10 },
    );
    const rateLimit = rateLimitField(entry.value, `${path}.rateLimit`, issues);

    if (alias !== undefined) {
      const lowerAlias = alias.toLowerCase();
      if (aliases.has(lowerAlias)) issues.push(configIssue(`${path}.alias`, "Agent aliases must be unique."));
      aliases.add(lowerAlias);
    }
    if (provider !== undefined && providers[provider] === undefined) {
      issues.push(configIssue(`${path}.provider`, `Unknown provider "${provider}".`));
    }

    if (
      id !== undefined &&
      name !== undefined &&
      alias !== undefined &&
      provider !== undefined &&
      systemPrompt !== undefined &&
      tools !== undefined &&
      commandAllowlist !== undefined &&
      timeout !== undefined &&
      ingameMessageWindow !== undefined &&
      rateLimit !== undefined
    ) {
      out[id] = {
        id,
        name,
        alias,
        provider,
        systemPrompt,
        tools,
        timeout,
        commandAllowlist,
        rateLimit,
        ingameMessageWindow,
      };
    }
  }

  return out;
}

function normalizePermissions(
  value: unknown,
  servers: Readonly<Record<string, ServerConfig>>,
  agents: Readonly<Record<string, AgentConfig>>,
  issues: ConfigDiagnostic[],
): Record<string, ServerPermissions> {
  const out: Record<string, ServerPermissions> = {};
  if (!isRecord(value)) {
    issues.push(configIssue("permissions", "Must be an object keyed by server id."));
    return out;
  }

  for (const [serverId, serverPermissions] of Object.entries(value)) {
    const path = `permissions.${serverId}`;
    if (!ID_PATTERN.test(serverId)) {
      issues.push(configIssue(path, "Server permission keys must match ^[a-zA-Z0-9_-]{1,32}$."));
      continue;
    }
    if (servers[serverId] === undefined) {
      issues.push(configIssue(path, `Unknown server "${serverId}".`));
    }
    if (!isRecord(serverPermissions) || !Array.isArray(serverPermissions.players)) {
      issues.push(configIssue(`${path}.players`, "Must be an array of players."));
      continue;
    }

    const players: PlayerConfig[] = [];
    for (let i = 0; i < serverPermissions.players.length; i++) {
      const playerPath = `${path}.players.${i}`;
      const player = serverPermissions.players[i];
      if (!isRecord(player)) {
        issues.push(configIssue(playerPath, "Player must be an object."));
        continue;
      }
      const name = stringField(player, "name", `${playerPath}.name`, issues, PLAYER_NAME_PATTERN);
      const playerAgents = stringArrayField(player, "agents", `${playerPath}.agents`, issues);
      const teamPrefix = optionalStringField(player, "teamPrefix", `${playerPath}.teamPrefix`, issues);
      const teamSuffix = optionalStringField(player, "teamSuffix", `${playerPath}.teamSuffix`, issues);
      const inGameAdmin = booleanField(player, "inGameAdmin", `${playerPath}.inGameAdmin`, issues, false);
      for (const agentId of playerAgents ?? []) {
        if (agents[agentId] === undefined) {
          issues.push(configIssue(`${playerPath}.agents`, `Unknown agent "${agentId}".`));
        }
      }
      if (name !== undefined && playerAgents !== undefined && inGameAdmin !== undefined) {
        players.push({
          name,
          ...(teamPrefix !== undefined ? { teamPrefix } : {}),
          ...(teamSuffix !== undefined ? { teamSuffix } : {}),
          agents: playerAgents,
          inGameAdmin,
        });
      }
    }
    out[serverId] = { players };
  }

  return out;
}

interface ConfigEntry {
  readonly key: string;
  readonly path: string;
  readonly value: Record<string, unknown>;
}

function configEntries(
  value: unknown,
  path: string,
  idKey: string,
  issues: ConfigDiagnostic[],
): ConfigEntry[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => entryFromValue(String(index), `${path}.${index}`, item, issues));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) => {
      const entries = entryFromValue(key, `${path}.${key}`, item, issues);
      const entry = entries[0];
      if (entry !== undefined && entry.value[idKey] === undefined) {
        entry.value[idKey] = key;
      }
      return entries;
    });
  }
  issues.push(configIssue(path, "Must be an array or object."));
  return [];
}

function entryFromValue(
  key: string,
  path: string,
  value: unknown,
  issues: ConfigDiagnostic[],
): ConfigEntry[] {
  if (!isRecord(value)) {
    issues.push(configIssue(path, "Entry must be an object."));
    return [];
  }
  return [{ key, path, value: { ...value } }];
}

function idField(entry: ConfigEntry, path: string, issues: ConfigDiagnostic[]): string | undefined {
  return stringField(entry.value, "id", `${path}.id`, issues, ID_PATTERN);
}

function namedField(
  entry: ConfigEntry,
  key: string,
  path: string,
  issues: ConfigDiagnostic[],
): string | undefined {
  const name = stringField(entry.value, key, `${path}.${key}`, issues, ID_PATTERN);
  if (name !== undefined && entry.key !== name && !/^\d+$/.test(entry.key)) {
    issues.push(configIssue(`${path}.${key}`, `Record key "${entry.key}" must match ${key} "${name}".`));
  }
  return name;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ConfigDiagnostic[],
  pattern?: RegExp,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    issues.push(configIssue(path, "Required string value is missing."));
    return undefined;
  }
  if (pattern !== undefined && !pattern.test(value)) {
    issues.push(configIssue(path, `Must match ${pattern.source}.`));
    return undefined;
  }
  return value;
}

function optionalStringField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ConfigDiagnostic[],
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    issues.push(configIssue(path, "Must be a non-empty string when set."));
    return undefined;
  }
  return value;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ConfigDiagnostic[],
  range: { readonly min: number; readonly max: number; readonly defaultValue?: number },
): number | undefined {
  const value = record[key];
  if (value === undefined) return range.defaultValue;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < range.min || parsed > range.max) {
    issues.push(configIssue(path, `Must be an integer from ${range.min} to ${range.max}.`));
    return undefined;
  }
  return parsed;
}

function booleanField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ConfigDiagnostic[],
  defaultValue: boolean,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  issues.push(configIssue(path, "Must be a boolean."));
  return undefined;
}

function enumField<T extends string>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  variants: ReadonlySet<T>,
  issues: ConfigDiagnostic[],
): T | undefined {
  const value = record[key];
  if (typeof value === "string" && variants.has(value as T)) return value as T;
  issues.push(configIssue(path, `Must be one of: ${[...variants].join(", ")}.`));
  return undefined;
}

function stringArrayField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ConfigDiagnostic[],
  defaultValue?: readonly string[],
): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) return defaultValue;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    issues.push(configIssue(path, "Must be an array of strings."));
    return undefined;
  }
  return value;
}

function secretEnvField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  env: Readonly<Record<string, string | undefined>>,
  issues: ConfigDiagnostic[],
): string | undefined {
  const reference = stringField(record, key, path, issues);
  if (reference === undefined) return undefined;
  const match = ENV_REFERENCE_PATTERN.exec(reference);
  if (match === null) {
    issues.push(configIssue(path, "Must be an environment reference like ${OPENAI_API_KEY}."));
    return undefined;
  }
  const envName = match[1]!;
  const value = env[envName];
  if (value === undefined || value.length === 0) {
    issues.push(configIssue(path, `Environment variable ${envName} is not set.`));
    return undefined;
  }
  return value;
}

function rateLimitField(
  record: Record<string, unknown>,
  path: string,
  issues: ConfigDiagnostic[],
): AgentConfig["rateLimit"] | undefined {
  const value = record.rateLimit;
  if (value === undefined) return { rpm: 10, cooldown: 0 };
  if (!isRecord(value)) {
    issues.push(configIssue(path, "Must be an object."));
    return undefined;
  }
  const rpm = numberField(value, "rpm", `${path}.rpm`, issues, {
    min: 1,
    max: 60,
    defaultValue: 10,
  });
  const cooldown = numberField(value, "cooldown", `${path}.cooldown`, issues, {
    min: 0,
    max: 300,
    defaultValue: 0,
  });
  if (rpm === undefined || cooldown === undefined) return undefined;
  return { rpm, cooldown };
}

function validateUrl(value: string, path: string, issues: ConfigDiagnostic[]): void {
  try {
    new URL(value);
  } catch {
    issues.push(configIssue(path, "Must be a valid URL."));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
