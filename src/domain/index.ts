import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export type ServerState = "STOPPED" | "STARTING" | "RUNNING" | "STOPPING" | "FAILED";

export const SERVER_STATES = [
  "STOPPED",
  "STARTING",
  "RUNNING",
  "STOPPING",
  "FAILED",
] as const satisfies readonly ServerState[];

export type ServerId = string & { readonly __brand: "ServerId" };
export type AgentId = string & { readonly __brand: "AgentId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type Alias = string & { readonly __brand: "Alias" };
export type PlayerName = string & { readonly __brand: "PlayerName" };

export interface CanonicalPath {
  readonly value: string;
  contains(other: CanonicalPath): boolean;
  resolve(relativePath: string): Promise<CanonicalPath>;
}

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_:.-]{1,128}$/;
const ALIAS_PATTERN = /^[a-zA-Z0-9_-]{2,}$/;
const PLAYER_NAME_PATTERN = /^[a-zA-Z0-9_]{1,16}$/;

export function serverId(value: string): ServerId {
  return branded(value, ID_PATTERN, "serverId") as ServerId;
}

export function agentId(value: string): AgentId {
  return branded(value, ID_PATTERN, "agentId") as AgentId;
}

export function sessionId(value: string): SessionId {
  return branded(value, SESSION_ID_PATTERN, "sessionId") as SessionId;
}

export function alias(value: string): Alias {
  return branded(value, ALIAS_PATTERN, "alias") as Alias;
}

export function playerName(value: string): PlayerName {
  return branded(value, PLAYER_NAME_PATTERN, "playerName") as PlayerName;
}

export function serverState(value: string): ServerState {
  if (!SERVER_STATES.includes(value as ServerState)) {
    throw new Error(`invalid serverState: ${value}`);
  }
  return value as ServerState;
}

export async function canonicalPath(path: string): Promise<CanonicalPath> {
  if (!isAbsolute(path)) throw new Error(`canonical path must be absolute: ${path}`);
  const value = await realpath(path);
  return makeCanonicalPath(value);
}

function makeCanonicalPath(value: string): CanonicalPath {
  return {
    value,
    contains(other) {
      const rel = relative(value, other.value);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    },
    async resolve(relativePath) {
      const child = await canonicalPath(resolve(value, relativePath));
      if (!this.contains(child)) {
        throw new Error("PATH_TRAVERSAL_BLOCKED: path resolves outside sandbox root");
      }
      return child;
    },
  };
}

function branded(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) throw new Error(`invalid ${label}: ${value}`);
  return value;
}
