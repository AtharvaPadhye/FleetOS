/**
 * Structured logs (NFR OBS-2): one JSON object per line on stdout/stderr, which Vercel's log view and log drains
 * index by field. Every line carries an `event` name; pass `request_id` / `org_id` when known so a page, its API
 * calls and the tick can be followed across. Values under secret-looking keys are redacted, never logged.
 */

type Level = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const SECRET_KEY = /token|secret|password|authorization|cookie|api[_-]?key|email/i;

function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]),
  );
}

export function formatLog(level: Level, event: string, fields: LogFields = {}, now = new Date()): string {
  return JSON.stringify({ ts: now.toISOString(), level, event, ...(redact(fields) as LogFields) });
}

function write(level: Level, event: string, fields?: LogFields) {
  const line = formatLog(level, event, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
