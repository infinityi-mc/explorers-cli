import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

describe("OpenAPI contract artifact", () => {
  test("loads the LLD spec", () => {
    const spec = parse(readFileSync("docs/lld/tui-cli-process/openapi.yaml", "utf8")) as {
      openapi?: string;
      paths?: Record<string, unknown>;
    };

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths?.["/operator/start"]).toBeDefined();
    expect(spec.paths?.["/operator/chat"]).toBeDefined();
    expect(spec.paths?.["/operator/session"]).toBeDefined();
    expect(spec.paths?.["/operator/resume"]).toBeDefined();
    expect(spec.paths?.["/operator/clear"]).toBeDefined();
    expect(spec.paths?.["/ingame/tellraw"]).toBeDefined();
  });
});
