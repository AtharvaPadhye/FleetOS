import { ApiProblem } from "./handler";

/** Opaque page cursors: base64url JSON. Clients must pass them back unchanged. */
export function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor<T extends Record<string, string | number>>(
  cursor: string | undefined,
  check: (v: Record<string, unknown>) => v is T,
): T | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (v && typeof v === "object" && check(v as Record<string, unknown>)) return v as T;
  } catch {
    // fall through
  }
  throw new ApiProblem("invalid_request", "That cursor isn't valid. Start again from the first page.");
}

export const isOffsetCursor = (v: Record<string, unknown>): v is { o: number } =>
  Number.isInteger(v.o) && (v.o as number) >= 0;

export const isKeysetCursor = (v: Record<string, unknown>): v is { at: string; id: string } =>
  typeof v.at === "string" && !Number.isNaN(Date.parse(v.at)) && typeof v.id === "string" && /^[\w-]{1,64}$/.test(v.id);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path ids that aren't UUIDs can't exist: answer 404 like any other unknown id. */
export function uuidParam(params: Record<string, string>, name = "id"): string {
  const v = params[name];
  if (!v || !UUID.test(v)) throw new ApiProblem("not_found", "No such resource.");
  return v;
}
