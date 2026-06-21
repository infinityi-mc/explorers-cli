import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { agentId, alias, canonicalPath, playerName, serverId, serverState, sessionId } from "../src/domain";

describe("domain value objects", () => {
  test("validates IDs, aliases, player names, sessions, and server states", () => {
    expect(String(serverId("survival_1"))).toBe("survival_1");
    expect(String(agentId("assistant-1"))).toBe("assistant-1");
    expect(String(alias("helper"))).toBe("helper");
    expect(String(playerName("Steve_123"))).toBe("Steve_123");
    expect(String(sessionId("survival:assistant:1"))).toBe("survival:assistant:1");
    expect(serverState("RUNNING")).toBe("RUNNING");

    expect(() => serverId("bad id")).toThrow("invalid serverId");
    expect(() => agentId("x".repeat(33))).toThrow("invalid agentId");
    expect(() => alias("x")).toThrow("invalid alias");
    expect(() => playerName("Steve!")).toThrow("invalid playerName");
    expect(() => sessionId("../../etc/passwd")).toThrow("invalid sessionId");
    expect(() => sessionId(" ")).toThrow("invalid sessionId");
    expect(() => serverState("BOOTING")).toThrow("invalid serverState");
  });

  test("canonical path containment uses native path resolution", async () => {
    const dir = mkdtempSync(join(tmpdir(), "explorers-cli-domain-"));
    const outsidePath = join(dirname(dir), `${crypto.randomUUID()}-outside.txt`);
    try {
      writeFileSync(join(dir, "server.properties"), "server-port=25565\n", "utf8");
      writeFileSync(outsidePath, "outside\n", "utf8");
      const root = await canonicalPath(dir);
      const child = await root.resolve("server.properties");

      expect(root.contains(child)).toBe(true);
      await expect(root.resolve(`../${basename(outsidePath)}`)).rejects.toThrow("PATH_TRAVERSAL_BLOCKED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outsidePath, { force: true });
    }
  });
});
