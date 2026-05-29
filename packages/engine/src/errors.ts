/**
 * Typed engine errors.
 *
 * Every error the engine throws inherits from `EngineError` and carries a
 * stable string `code` so callers (the tRPC layer, the UI, tests) can branch
 * on the failure mode without string-matching error messages.
 *
 * Concrete adapters and stores translate their dialect-specific failures
 * (pg error codes, HTTP statuses, sqlite_busy, etc.) into these shapes at the
 * adapter boundary — the rest of the system never sees a raw `pg.DatabaseError`.
 */

export type EngineErrorCode =
  | "CONNECTION_ERROR"
  | "PERMISSION_DENIED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT";

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
}

// ---------------------------------------------------------------------------
// ConnectionError — anything that prevents the engine from talking to the
// target DB or the metadata store: TCP refused, TLS failure, auth refused,
// timeout, network partition. Adapters map their native error codes into this.
// ---------------------------------------------------------------------------

export class ConnectionError extends EngineError {
  constructor(message: string, options?: ErrorOptions) {
    super("CONNECTION_ERROR", message, options);
  }
}

// ---------------------------------------------------------------------------
// PermissionDeniedError — engine-level permission failure in shared mode.
// Carries enough context for the UI to explain "you can't do <action> on
// <subject>" without leaking the underlying rule.
// ---------------------------------------------------------------------------

export interface PermissionDeniedOptions extends ErrorOptions {
  /** What was attempted, e.g. "perspective.update", "table.read". */
  action?: string;
  /** Identifier of the thing being acted on, e.g. "perspective:01J...". */
  subject?: string;
}

export class PermissionDeniedError extends EngineError {
  readonly action: string | undefined;
  readonly subject: string | undefined;

  constructor(message: string, options?: PermissionDeniedOptions) {
    super("PERMISSION_DENIED", message, options);
    this.action = options?.action;
    this.subject = options?.subject;
  }
}

// ---------------------------------------------------------------------------
// ValidationError — input failed a structured check (e.g. a DSL payload didn't
// pass the Zod schema, or a mutation tried to write a value the column type
// rejects before SQL even runs). `issues` is opaque so we don't drag a zod
// import into the engine surface.
// ---------------------------------------------------------------------------

export interface ValidationErrorOptions extends ErrorOptions {
  /** Structured issue list — typically `ZodIssue[]`, but kept opaque here. */
  issues?: unknown;
}

export class ValidationError extends EngineError {
  readonly issues: unknown;

  constructor(message: string, options?: ValidationErrorOptions) {
    super("VALIDATION_ERROR", message, options);
    this.issues = options?.issues;
  }
}

// ---------------------------------------------------------------------------
// NotFoundError — a record (perspective, relation, row, workspace, …) didn't
// exist when expected to.
// ---------------------------------------------------------------------------

export interface NotFoundErrorOptions extends ErrorOptions {
  /** What kind of resource was missing, e.g. "perspective", "relation", "row". */
  resource?: string;
  /** Identifier the caller looked up. */
  id?: string;
}

export class NotFoundError extends EngineError {
  readonly resource: string | undefined;
  readonly id: string | undefined;

  constructor(message: string, options?: NotFoundErrorOptions) {
    super("NOT_FOUND", message, options);
    this.resource = options?.resource;
    this.id = options?.id;
  }
}

// ---------------------------------------------------------------------------
// ConflictError — optimistic-locking failure or unique-constraint violation.
// For optimistic locking the engine populates `expected` (the version the
// writer asserted) and `actual` (what's in the DB) so the UI can render a diff.
// ---------------------------------------------------------------------------

export interface ConflictErrorOptions extends ErrorOptions {
  /** Snapshot of the row state the writer asserted before the mutation. */
  expected?: unknown;
  /** Snapshot of the row state actually present at write time. */
  actual?: unknown;
}

export class ConflictError extends EngineError {
  readonly expected: unknown;
  readonly actual: unknown;

  constructor(message: string, options?: ConflictErrorOptions) {
    super("CONFLICT", message, options);
    this.expected = options?.expected;
    this.actual = options?.actual;
  }
}
