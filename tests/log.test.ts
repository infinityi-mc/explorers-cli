import { describe, expect, test } from "bun:test";
import { LineSplitter, ServerLogStore } from "../src/log";

describe("server log ingestion", () => {
  test("splits lines across chunks and flushes trailing text", () => {
    const splitter = new LineSplitter();

    expect(splitter.push(new TextEncoder().encode("one\nt"))).toEqual(["one"]);
    expect(splitter.push(new TextEncoder().encode("wo\r\nthree"))).toEqual(["two"]);
    expect(splitter.flush()).toEqual(["three"]);
  });

  test("rate limits lines per server", () => {
    let now = 0;
    const store = new ServerLogStore({ maxLinesPerSecond: 2, now: () => now });

    expect(store.ingest("survival", "one")).toBe(true);
    expect(store.ingest("survival", "two")).toBe(true);
    expect(store.ingest("survival", "three")).toBe(false);
    now = 500;
    expect(store.ingest("survival", "four")).toBe(true);

    const snapshot = store.snapshot("survival");
    expect(snapshot.lines.map((line) => line.text)).toEqual(["one", "two", "four"]);
    expect(snapshot.droppedRateLimited).toBe(1);
  });

  test("evicts oldest lines to keep byte cap", () => {
    const store = new ServerLogStore({ capacityBytes: 5, maxLinesPerSecond: 100 });

    expect(store.ingest("survival", "aa")).toBe(true);
    expect(store.ingest("survival", "bb")).toBe(true);
    expect(store.ingest("survival", "cc")).toBe(true);

    const snapshot = store.snapshot("survival");
    expect(snapshot.bytes).toBeLessThanOrEqual(5);
    expect(snapshot.lines.map((line) => line.text)).toEqual(["bb", "cc"]);
    expect(snapshot.evicted).toBe(1);
    expect(snapshot.droppedBufferFull).toBe(1);
  });

  test("drops single lines larger than buffer", () => {
    const store = new ServerLogStore({ capacityBytes: 3, maxLinesPerSecond: 100 });

    expect(store.ingest("survival", "abcd")).toBe(false);

    const snapshot = store.snapshot("survival");
    expect(snapshot.lines).toEqual([]);
    expect(snapshot.droppedBufferFull).toBe(1);
  });

  test("snapshot does not expose mutable backing lines", () => {
    const store = new ServerLogStore({ maxLinesPerSecond: 100 });
    store.ingest("survival", "one");

    const snapshot = store.snapshot("survival");
    (snapshot.lines as unknown as { pop(): unknown }).pop();

    expect(store.snapshot("survival").lines.map((line) => line.text)).toEqual(["one"]);
  });
});
