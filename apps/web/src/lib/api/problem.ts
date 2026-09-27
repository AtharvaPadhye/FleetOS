import type { ErrorCode } from "./schemas";

/** Throw from a handler to answer with a standard error body (api.md §1 "Errors"). */
export class ApiProblem extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>[],
  ) {
    super(message);
  }
}
