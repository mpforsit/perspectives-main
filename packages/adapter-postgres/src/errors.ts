/**
 * Map PostgreSQL driver errors into the engine's typed error hierarchy.
 *
 * pg's `Error` carries a SQLSTATE `code` field for any error that reached the
 * server; lower-level failures (ECONNREFUSED, ETIMEDOUT, ENOTFOUND, TLS) carry
 * a Node-style `code` instead. We branch on both, defaulting to
 * `ConnectionError` for anything we can't classify so the caller always sees
 * an `EngineError` rather than a raw `pg.DatabaseError`.
 */

import {
  ConflictError,
  ConnectionError,
  type EngineError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@perspectives/engine";

type ErrorWithCode = Error & { code?: string };

/** Node-level network errors that come from libpq before any SQL runs. */
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

export function mapPgError(cause: unknown, fallbackMessage: string): EngineError {
  if (!(cause instanceof Error)) {
    return new ConnectionError(fallbackMessage, { cause });
  }
  const code = (cause as ErrorWithCode).code;
  const message = cause.message || fallbackMessage;

  // No code at all — it's a Node-level failure (DNS, network, TLS). Treat as
  // connection error.
  if (code === undefined) {
    return new ConnectionError(message, { cause });
  }

  // Node-style network code.
  if (NETWORK_ERROR_CODES.has(code)) {
    return new ConnectionError(message, { cause });
  }

  // SQLSTATE class 08 — connection exceptions (connection_failure, etc.).
  if (code.startsWith("08")) {
    return new ConnectionError(message, { cause });
  }
  // SQLSTATE class 28 — invalid authorization specification.
  if (code.startsWith("28")) {
    return new ConnectionError(message, { cause });
  }
  // SQLSTATE 57014 — query_canceled. Surfaced when the caller's AbortSignal
  // fires or `statement_timeout` trips. The renderer should distinguish "you
  // hit cancel / it timed out" from "the database died", so we map it to a
  // ValidationError with a normalized message.
  if (code === "57014") {
    return new ValidationError(
      message.includes("statement timeout") ? message : `Query canceled: ${message}`,
      { cause },
    );
  }
  // Other SQLSTATE class 57 — operator intervention (admin shutdown, etc.).
  if (code.startsWith("57")) {
    return new ConnectionError(message, { cause });
  }

  switch (code) {
    // Undefined table / view / function / column → caller-side mistake.
    case "42P01":
      return new NotFoundError(message, { cause, resource: "table" });
    case "42883":
      return new NotFoundError(message, { cause, resource: "function" });
    case "42703":
    case "42P02":
    case "42P18":
    case "22P02": // invalid_text_representation (e.g. bad cast literal)
    case "22008": // datetime_field_overflow
    case "22023": // invalid_parameter_value
    case "22007": // invalid_datetime_format
    case "42601": // syntax_error
    case "42804": // datatype_mismatch
    case "25006": // read_only_sql_transaction
      return new ValidationError(message, { cause });

    // Integrity-constraint violations.
    case "23502": // not_null_violation
    case "23503": // foreign_key_violation
    case "23514": // check_violation
      return new ValidationError(message, { cause });
    case "23505": // unique_violation
      return new ConflictError(message, { cause });

    // AuthZ.
    case "42501":
      return new PermissionDeniedError(message, { cause });

    default:
      // Anything else — preserve the message but wrap as ConnectionError. We
      // pick ConnectionError rather than EngineError directly so callers can
      // still use the typed `instanceof` branches without a generic catch-all.
      return new ConnectionError(message, { cause });
  }
}
