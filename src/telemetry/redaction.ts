const REDACTION = "[REDACTED]";

export const defaultRedactionPatterns: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,}\n]+)/gi,
];

const SENSITIVE_KEY_PATTERN = /api[_-]?key|token|secret|password/i;

export function redactText(value: string): string {
  let out = value;
  for (const pattern of defaultRedactionPatterns) {
    out = out.replace(pattern, (match) => {
      const separator = match.match(/\s*[:=]\s*/)?.[0];
      if (separator === undefined) return REDACTION;
      return `${match.slice(0, match.indexOf(separator))}${separator}${REDACTION}`;
    });
  }
  return out;
}

export function redactValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack === undefined ? undefined : redactText(value.stack),
    };
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const item of value) out.push(redactValue(item, seen));
    return out;
  }

  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [key, child] of Object.entries(value)) {
    // ponytail: Keep PR1 redaction local; later phases can swap in engine-lib patterns if exported.
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTION : redactValue(child, seen);
  }
  return out;
}
