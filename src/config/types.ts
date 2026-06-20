export type RuntimeMode = "normal" | "read-only" | "validate-config";

export interface RuntimeOptions {
  readonly mode: RuntimeMode;
  readonly configPath: string;
  readonly verbose: boolean;
  readonly argv: readonly string[];
}

export type ProviderType = "openai" | "anthropic" | "openai-compatible";

export interface ServerConfig {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly jarFile: string;
  readonly ram: number;
  readonly javaPath: string;
  readonly serverPort: number;
  readonly maxPlayers: number;
  readonly levelName: string;
  readonly startupTimeout: number;
}

export interface ProviderConfig {
  readonly name: string;
  readonly type: ProviderType;
  readonly baseUrl?: string;
  readonly model: string;
  readonly apiKey: string;
}

export interface AgentConfig {
  readonly id: string;
  readonly name: string;
  readonly alias: string;
  readonly provider: string;
  readonly systemPrompt: string;
  readonly tools: readonly string[];
  readonly timeout: number;
  readonly commandAllowlist: readonly string[];
  readonly rateLimit: {
    readonly rpm: number;
    readonly cooldown: number;
  };
  readonly ingameMessageWindow: number;
}

export interface PlayerConfig {
  readonly name: string;
  readonly teamPrefix?: string;
  readonly teamSuffix?: string;
  readonly agents: readonly string[];
  readonly inGameAdmin: boolean;
}

export interface ServerPermissions {
  readonly players: readonly PlayerConfig[];
}

export type LoggingLevel = "trace" | "debug" | "info";

export interface RuntimeConfig {
  readonly schemaVersion: number;
  readonly servers: Readonly<Record<string, ServerConfig>>;
  readonly providers: Readonly<Record<string, ProviderConfig>>;
  readonly agents: Readonly<Record<string, AgentConfig>>;
  readonly permissions: Readonly<Record<string, ServerPermissions>>;
  readonly featureFlags: {
    readonly audioplayer: boolean;
  };
  readonly telemetry: {
    readonly enabled: boolean;
    readonly endpoint?: string;
  };
  readonly logging: {
    readonly level: LoggingLevel;
    readonly rotationBytes: number;
  };
  readonly sessionRetention: string;
}
