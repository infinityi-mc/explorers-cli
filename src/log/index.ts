export const LOG_COMPONENT = "log-reader";

export interface LogLine {
  readonly serverId: string;
  readonly text: string;
  readonly timestamp: number;
  readonly byteLength: number;
}

export interface LogBufferSnapshot {
  readonly serverId: string;
  readonly lines: readonly LogLine[];
  readonly bytes: number;
  readonly capacityBytes: number;
  readonly ingested: number;
  readonly droppedRateLimited: number;
  readonly droppedBufferFull: number;
  readonly evicted: number;
}

export interface LogStoreOptions {
  readonly capacityBytes?: number;
  readonly maxLinesPerSecond?: number;
  readonly now?: () => number;
}

const DEFAULT_CAPACITY_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_LINES_PER_SECOND = 5_000;

export class ServerLogStore {
  private readonly buffers = new Map<string, LogRingBuffer>();

  constructor(private readonly options: LogStoreOptions = {}) {}

  ingest(serverId: string, text: string): boolean {
    return this.buffer(serverId).push(text);
  }

  attach(serverId: string, stream: ReadableStream<Uint8Array> | null | undefined, prefix = ""): void {
    if (stream === null || stream === undefined) return;
    void readLogStream(stream, (line) => {
      this.ingest(serverId, prefix.length === 0 ? line : `${prefix}${line}`);
    }).catch(() => {});
  }

  snapshot(serverId: string, limit?: number): LogBufferSnapshot {
    return this.buffer(serverId).snapshot(limit);
  }

  private buffer(serverId: string): LogRingBuffer {
    const existing = this.buffers.get(serverId);
    if (existing !== undefined) return existing;
    const next = new LogRingBuffer(serverId, {
      capacityBytes: this.options.capacityBytes ?? DEFAULT_CAPACITY_BYTES,
      maxLinesPerSecond: this.options.maxLinesPerSecond ?? DEFAULT_MAX_LINES_PER_SECOND,
      now: this.options.now ?? Date.now,
    });
    this.buffers.set(serverId, next);
    return next;
  }
}

export class LineSplitter {
  private buffer = "";
  private readonly decoder = new TextDecoder();

  push(chunk: Uint8Array): readonly string[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drainComplete();
  }

  flush(): readonly string[] {
    this.buffer += this.decoder.decode();
    if (this.buffer.length === 0) return [];
    const line = trimCarriageReturn(this.buffer);
    this.buffer = "";
    return [line];
  }

  private drainComplete(): readonly string[] {
    const out: string[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      out.push(trimCarriageReturn(this.buffer.slice(0, newline)));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
    }
    return out;
  }
}

class LogRingBuffer {
  private readonly lines: LogLine[] = [];
  private readonly limiter: TokenBucket;
  private bytes = 0;
  private ingested = 0;
  private droppedRateLimited = 0;
  private droppedBufferFull = 0;
  private evicted = 0;

  constructor(
    private readonly serverId: string,
    private readonly options: Required<LogStoreOptions>,
  ) {
    this.limiter = new TokenBucket(options.maxLinesPerSecond, options.now);
  }

  push(text: string): boolean {
    if (!this.limiter.tryAcquire()) {
      this.droppedRateLimited++;
      return false;
    }

    const byteLength = new TextEncoder().encode(text).byteLength;
    if (byteLength > this.options.capacityBytes) {
      this.droppedBufferFull++;
      return false;
    }

    while (this.bytes + byteLength > this.options.capacityBytes) {
      const removed = this.lines.shift();
      if (removed === undefined) break;
      this.bytes -= removed.byteLength;
      this.evicted++;
      this.droppedBufferFull++;
    }

    this.lines.push({ serverId: this.serverId, text, timestamp: this.options.now(), byteLength });
    this.bytes += byteLength;
    this.ingested++;
    return true;
  }

  snapshot(limit?: number): LogBufferSnapshot {
    const lines = limit === undefined ? [...this.lines] : this.lines.slice(-limit);
    return {
      serverId: this.serverId,
      lines,
      bytes: this.bytes,
      capacityBytes: this.options.capacityBytes,
      ingested: this.ingested,
      droppedRateLimited: this.droppedRateLimited,
      droppedBufferFull: this.droppedBufferFull,
      evicted: this.evicted,
    };
  }
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(private readonly ratePerSecond: number, private readonly now: () => number) {
    this.tokens = ratePerSecond;
    this.lastRefill = now();
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }

  private refill(): void {
    const now = this.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.ratePerSecond, this.tokens + (elapsed / 1000) * this.ratePerSecond);
    this.lastRefill = now;
  }
}

async function readLogStream(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = stream.getReader();
  const splitter = new LineSplitter();
  try {
    while (true) {
      const next = await reader.read();
      for (const line of next.done ? splitter.flush() : splitter.push(next.value)) onLine(line);
      if (next.done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

function trimCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}
