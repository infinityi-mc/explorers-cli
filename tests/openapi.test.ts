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
  });
});
