import { defineTool, type ToolDefinition, type ToolResult } from "@infinityi/engine-lib/tools";
import { s } from "@infinityi/engine-lib/schema";
import type { AuditLog } from "@infinityi/engine-lib/governance";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { AgentConfig, RuntimeConfig } from "../config";
import type { ServerRuntimeSnapshot } from "../process";

export const TOOLS_COMPONENT = "tool-sandbox-broker";

export type ToolBrokerErrorCode = "COMMAND_BLOCKED" | "FILE_BLOCKED" | "OFFLINE_FAIL" | "PATH_TRAVERSAL_BLOCKED" | "INTERNAL_ERROR";

export interface ToolSandboxBrokerOptions {
  readonly config: RuntimeConfig;
  readonly lifecycle: {
    snapshot(serverId: string): ServerRuntimeSnapshot;
    sendCommand(serverId: string, line: string): Promise<{ readonly ok: boolean; readonly code?: string; readonly message?: string }>;
  };
  readonly auditLog?: AuditLog;
}

export class ToolSandboxBroker {
  constructor(private readonly options: ToolSandboxBrokerOptions) {}

  toolsFor(input: { readonly serverId?: string; readonly agentId: string }): readonly ToolDefinition[] {
    if (input.serverId === undefined) return [];
    const server = this.options.config.servers[input.serverId];
    const agent = this.options.config.agents[input.agentId];
    if (server === undefined || agent === undefined) return [];
    const tools: ToolDefinition[] = [];
    if (agent.tools.includes("run_command")) tools.push(this.runCommandTool(input.serverId, agent));
    if (agent.tools.includes("read_file")) tools.push(this.readFileTool(input.serverId, agent.id));
    if (agent.tools.includes("write_file")) tools.push(this.writeFileTool(input.serverId, agent.id));
    return tools;
  }

  private runCommandTool(serverId: string, agent: AgentConfig): ToolDefinition<{ readonly command: string }> {
    return defineTool({
      name: "run_command",
      description: "Execute a Minecraft console command on the current server. Allowed commands are configured by the operator.",
      parameters: s.object({ command: s.string() }),
      execute: async ({ command }, ctx) => {
        const target = firstToken(command) ?? "";
        const digest = digestArgs({ command });
        const playerName = ctx.principal ?? "operator";
        if (/\r|\n/.test(command) || !matchesAllowlist(command, agent.commandAllowlist)) {
          await this.audit({ serverId, agentId: agent.id, playerName, actionType: "command_exec", target, outcome: "blocked", detail: "COMMAND_BLOCKED", argumentsDigest: digest });
          return failure("COMMAND_BLOCKED", `Command "${target}" is not in the allowlist.`);
        }
        if (this.options.lifecycle.snapshot(serverId).state !== "RUNNING") {
          await this.audit({ serverId, agentId: agent.id, playerName, actionType: "command_exec", target, outcome: "blocked", detail: "OFFLINE_FAIL", argumentsDigest: digest });
          return failure("OFFLINE_FAIL", `Server "${serverId}" is not running.`);
        }
        const result = await this.options.lifecycle.sendCommand(serverId, command);
        if (!result.ok) {
          const code = result.code === "NOT_RUNNING" ? "OFFLINE_FAIL" : "INTERNAL_ERROR";
          await this.audit({ serverId, agentId: agent.id, playerName, actionType: "command_exec", target, outcome: "failed", detail: code, argumentsDigest: digest });
          return failure(code, result.message ?? code);
        }
        await this.audit({ serverId, agentId: agent.id, playerName, actionType: "command_exec", target, outcome: "ok", detail: "sent", argumentsDigest: digest });
        return { ok: true, content: `sent ${command}` };
      },
    });
  }

  private readFileTool(serverId: string, agentId: string): ToolDefinition<{ readonly path: string }> {
    return defineTool({
      name: "read_file",
      description: "Read a UTF-8 file inside the current server sandbox.",
      parameters: s.object({ path: s.string() }),
      execute: async ({ path }, ctx) => {
        const digest = digestArgs({ path });
        const playerName = ctx.principal ?? "operator";
        const resolved = await this.resolveSandboxPath(serverId, path, false);
        if (!resolved.ok) {
          await this.audit({ serverId, agentId, playerName, actionType: "file_read", target: redactTarget(path), outcome: "blocked", detail: resolved.error, argumentsDigest: digest });
          return failure(resolved.code, resolved.error);
        }
        try {
          const content = await readFile(resolved.path, "utf8");
          await this.audit({ serverId, agentId, playerName, actionType: "file_read", target: redactTarget(path), outcome: "ok", detail: `read ${content.length} chars`, argumentsDigest: digest });
          return { ok: true, content };
        } catch (error) {
          const detail = fsErrorDetail(error);
          await this.audit({ serverId, agentId, playerName, actionType: "file_read", target: redactTarget(path), outcome: "failed", detail, argumentsDigest: digest });
          return failure("FILE_BLOCKED", `File access blocked: ${detail}.`);
        }
      },
    });
  }

  private writeFileTool(serverId: string, agentId: string): ToolDefinition<{ readonly path: string; readonly content: string }> {
    return defineTool({
      name: "write_file",
      description: "Write a UTF-8 file inside the current server sandbox.",
      parameters: s.object({ path: s.string(), content: s.string() }),
      execute: async ({ path, content }, ctx) => {
        const digest = digestArgs({ path, content });
        const playerName = ctx.principal ?? "operator";
        const resolved = await this.resolveSandboxPath(serverId, path, true);
        if (!resolved.ok) {
          await this.audit({ serverId, agentId, playerName, actionType: "file_write", target: redactTarget(path), outcome: "blocked", detail: resolved.error, argumentsDigest: digest });
          return failure(resolved.code, resolved.error);
        }
        if (this.options.lifecycle.snapshot(serverId).state === "RUNNING" && isNbtSensitive(resolved.path)) {
          await this.audit({ serverId, agentId, playerName, actionType: "file_write", target: redactTarget(path), outcome: "blocked", detail: "FILE_BLOCKED", argumentsDigest: digest });
          return failure("FILE_BLOCKED", "File access blocked: NBT-sensitive writes are blocked while the server is running.");
        }
        try {
          await mkdir(dirname(resolved.path), { recursive: true });
          await writeFile(resolved.path, content, "utf8");
          await this.audit({ serverId, agentId, playerName, actionType: "file_write", target: redactTarget(path), outcome: "ok", detail: `wrote ${content.length} chars`, argumentsDigest: digest });
          return { ok: true, content: `wrote ${content.length} bytes to ${path}` };
        } catch (error) {
          const detail = fsErrorDetail(error);
          await this.audit({ serverId, agentId, playerName, actionType: "file_write", target: redactTarget(path), outcome: "failed", detail, argumentsDigest: digest });
          return failure("FILE_BLOCKED", `File access blocked: ${detail}.`);
        }
      },
    });
  }

  private async resolveSandboxPath(serverId: string, inputPath: string, allowMissing: boolean): Promise<{ readonly ok: true; readonly path: string } | { readonly ok: false; readonly code: ToolBrokerErrorCode; readonly error: string }> {
    const server = this.options.config.servers[serverId];
    if (server === undefined) return { ok: false, code: "INTERNAL_ERROR", error: `Server "${serverId}" is not configured.` };
    const root = await realpath(server.path);
    if (isAbsolute(inputPath)) return { ok: false, code: "PATH_TRAVERSAL_BLOCKED", error: "Path resolves outside the canonical server.path." };
    const candidate = resolve(root, inputPath);
    if (!isContained(root, candidate)) return { ok: false, code: "PATH_TRAVERSAL_BLOCKED", error: "Path resolves outside the canonical server.path." };
    try {
      const canonical = await realpath(candidate);
      if (!isContained(root, canonical)) return { ok: false, code: "PATH_TRAVERSAL_BLOCKED", error: "Path resolves outside the canonical server.path." };
      return { ok: true, path: canonical };
    } catch (error) {
      if (!allowMissing || !isMissingPath(error)) return { ok: false, code: "FILE_BLOCKED", error: "File access blocked: path does not exist." };
      const parent = await nearestExistingParent(root, dirname(candidate));
      if (parent === undefined || !isContained(root, parent)) return { ok: false, code: "PATH_TRAVERSAL_BLOCKED", error: "Path resolves outside the canonical server.path." };
      return { ok: true, path: candidate };
    }
  }

  private async audit(entry: { readonly serverId: string; readonly agentId: string; readonly playerName: string; readonly actionType: string; readonly target: string; readonly outcome: "ok" | "blocked" | "failed"; readonly detail: string; readonly argumentsDigest: string }): Promise<void> {
    await this.options.auditLog?.record({
      timestamp: new Date().toISOString(),
      agent: entry.agentId,
      action: "tool.result",
      target: entry.target,
      principal: entry.playerName,
      detail: entry,
    });
  }
}

function matchesAllowlist(command: string, allowlist: readonly string[]): boolean {
  const commandTokens = tokenize(command);
  if (commandTokens.length === 0) return false;
  return allowlist.some((allowed) => {
    const allowedTokens = tokenize(allowed);
    if (allowedTokens.length === 0 || allowedTokens.length > commandTokens.length) return false;
    return allowedTokens.every((token, index) => token.toLowerCase() === commandTokens[index]?.toLowerCase());
  });
}

function tokenize(command: string): string[] {
  return command.trim().replace(/^\//, "").split(/\s+/).filter(Boolean);
}

function firstToken(command: string): string | undefined {
  return tokenize(command)[0];
}

function isContained(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isNbtSensitive(path: string): boolean {
  return new Set([".nbt", ".dat", ".mca", ".schem"]).has(extname(path).toLowerCase());
}

async function nearestExistingParent(root: string, start: string): Promise<string | undefined> {
  let current = start;
  while (isContained(root, current)) {
    const parent = await realpath(current).catch(() => undefined);
    if (parent !== undefined) return parent;
    const next = dirname(current);
    if (next === current) return undefined;
    current = next;
  }
  return undefined;
}

function failure(code: ToolBrokerErrorCode, message: string): ToolResult {
  return { ok: false, error: `${code}: ${message}` };
}

function digestArgs(args: unknown): string {
  const text = JSON.stringify(args);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function redactTarget(target: string): string {
  return target.replace(/[A-Za-z0-9_]*secret[A-Za-z0-9_]*/gi, "[REDACTED]").slice(0, 200);
}

function fsErrorDetail(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return "filesystem error";
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
