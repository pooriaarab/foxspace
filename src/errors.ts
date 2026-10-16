// One error type with a code, so callers can tell a bad space from a broken store.

export type FoxspaceErrorCode = "bad-space" | "bad-store" | "bad-import" | "too-large" | "not-found" | "bad-request";

export class FoxspaceError extends Error {
  readonly code: FoxspaceErrorCode;
  constructor(code: FoxspaceErrorCode, message: string) {
    super(message);
    this.name = "FoxspaceError";
    this.code = code;
  }
}
