/**
 * Pure formatting helpers shared by the cell renderers and the copy-to-clipboard
 * machinery. Everything here is deterministic and side-effect-free so it can
 * be unit-tested without rendering a single component.
 */

export type CellKind =
  | "null"
  | "boolean"
  | "number"
  | "timestamp"
  | "date"
  | "time"
  | "json"
  | "array"
  | "bytes"
  | "text";

const NUMERIC_TYPES = new Set([
  "int2",
  "int4",
  "int8",
  "smallint",
  "integer",
  "bigint",
  "numeric",
  "decimal",
  "float4",
  "float8",
  "real",
  "double precision",
  "money",
  "oid",
]);

const TIMESTAMP_TYPES = new Set([
  "timestamp",
  "timestamptz",
  "timestamp without time zone",
  "timestamp with time zone",
]);

const DATE_TYPES = new Set(["date"]);

const TIME_TYPES = new Set([
  "time",
  "timetz",
  "time without time zone",
  "time with time zone",
]);

const JSON_TYPES = new Set(["json", "jsonb"]);
const BOOLEAN_TYPES = new Set(["bool", "boolean"]);
const BYTES_TYPES = new Set(["bytea", "blob", "varbinary", "binary"]);

/**
 * Whether a value is a binary blob — Node's Buffer or any TypedArray.
 * Detected via duck-type because Buffer is a Uint8Array subclass and the
 * renderer also wants to recognise raw ArrayBuffer payloads.
 */
export function isBinary(value: unknown): boolean {
  if (value instanceof Uint8Array) return true;
  if (value instanceof ArrayBuffer) return true;
  return false;
}

/**
 * Postgres reports array types as the element type prefixed with `_`
 * (`_text`, `_int4`). User-typed display forms also use `text[]`.
 */
export function isArrayType(dbType: string): boolean {
  const t = dbType.toLowerCase().trim();
  return t.startsWith("_") || t.endsWith("[]");
}

/**
 * Classify a (dbType, value) pair into one of the renderable cell kinds.
 * Value wins over dbType for non-null values so that JSONB-of-number doesn't
 * try to right-align an object. Null is its own kind regardless of column.
 */
export function classifyCell(dbType: string, value: unknown): CellKind {
  if (value === null || value === undefined) return "null";

  if (isBinary(value)) return "bytes";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" || typeof value === "bigint") return "number";

  const t = dbType.toLowerCase().trim();

  if (BYTES_TYPES.has(t)) return "bytes";
  if (isArrayType(t)) return "array";
  if (BOOLEAN_TYPES.has(t)) return "boolean";
  if (NUMERIC_TYPES.has(t)) return "number";
  if (TIMESTAMP_TYPES.has(t)) return "timestamp";
  if (DATE_TYPES.has(t)) return "date";
  if (TIME_TYPES.has(t)) return "time";
  if (JSON_TYPES.has(t)) return "json";

  if (typeof value === "object") return "json";

  return "text";
}

/**
 * Whether the column header (and cells) should be right-aligned. Numbers only.
 */
export function isRightAligned(dbType: string): boolean {
  const t = dbType.toLowerCase().trim();
  return NUMERIC_TYPES.has(t);
}

const TIMESTAMP_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const NUMBER_FMT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 });

/**
 * Format a timestamp value as `YYYY-MM-DD HH:MM:SS`. Accepts ISO strings or
 * Date instances; leaves anything unparseable as the raw string. The
 * `en-CA` locale renders parts in ISO order which gives us a stable, sortable
 * display without writing our own padding logic.
 */
export function formatTimestamp(value: unknown): string {
  const date = toDate(value);
  if (date === null) return String(value);
  const parts = TIMESTAMP_FMT.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function formatDate(value: unknown): string {
  const date = toDate(value);
  if (date === null) return String(value);
  return DATE_FMT.format(date);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatNumber(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    return NUMBER_FMT.format(value);
  }
  if (typeof value === "string" && value.length > 0 && !Number.isNaN(Number(value))) {
    return NUMBER_FMT.format(Number(value));
  }
  return String(value);
}

/**
 * Stringify JSON/array values. Pretty-printed for the modal (in 1.9) but
 * here returned compact for the cell. Cycles are handled defensively because
 * pg driver output is plain JSON, but we don't want a single bad payload to
 * crash the grid.
 */
export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Truncate any string to `max` characters, appending an ellipsis. Returns the
 * input unchanged if already shorter.
 */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)) + "…";
}

/**
 * The single source of truth for "what string does this cell display?".
 * The renderer wraps this in JSX (styling, expand affordance, null badge),
 * but copy-to-clipboard goes through this same function so what you see
 * is what you get.
 */
export function formatCell(dbType: string, value: unknown): string {
  const kind = classifyCell(dbType, value);
  switch (kind) {
    case "null":
      return "";
    case "boolean":
      return value === true ? "true" : value === false ? "false" : String(value);
    case "number":
      return formatNumber(value);
    case "timestamp":
      return formatTimestamp(value);
    case "date":
      return formatDate(value);
    case "time":
      return String(value);
    case "json":
    case "array":
      return formatJson(value);
    case "bytes":
      return formatBytesSummary(value);
    case "text":
      return typeof value === "string" ? value : String(value);
  }
}

/**
 * Human-readable summary of a binary blob for the cell display and clipboard.
 * `<bytea, 1024 bytes>` rather than letting the raw bytes turn into mojibake.
 * The detail view renders a more useful hex preview.
 */
export function formatBytesSummary(value: unknown): string {
  const length = bytesLength(value);
  if (length === null) return "<bytea>";
  return `<bytea, ${length.toLocaleString()} bytes>`;
}

export function bytesLength(value: unknown): number | null {
  if (value instanceof Uint8Array) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  return null;
}

/**
 * Hex-dump the first `maxBytes` of a binary value for the detail preview.
 * Returns an empty string if the value isn't binary.
 */
export function bytesPreview(value: unknown, maxBytes = 256): string {
  const arr =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  if (arr === null) return "";
  const slice = arr.subarray(0, Math.min(maxBytes, arr.byteLength));
  const out: string[] = [];
  for (let i = 0; i < slice.byteLength; i++) {
    const b = slice[i];
    out.push((b ?? 0).toString(16).padStart(2, "0"));
  }
  return out.join(" ");
}

/** TSV-escape a cell: replace tabs/newlines/carriage-returns with their literal escapes. */
function tsvEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

/**
 * Serialize a row as one TSV line — column order follows `columns`. NULL is
 * an empty field (TSV's only sensible null). Tabs/newlines in cell content
 * are escaped so the row is round-trippable.
 */
export function rowToTsv(row: Record<string, unknown>, columns: { name: string; dbType: string }[]): string {
  return columns
    .map((col) => {
      const value = row[col.name];
      if (value === null || value === undefined) return "";
      return tsvEscape(formatCell(col.dbType, value));
    })
    .join("\t");
}

/**
 * Serialize a row as a JSON object using the columns' logical names as keys.
 * BigInts get stringified — JSON.stringify would otherwise throw.
 */
export function rowToJson(row: Record<string, unknown>, columns: { name: string }[]): string {
  const obj: Record<string, unknown> = {};
  for (const col of columns) {
    const v = row[col.name];
    obj[col.name] = typeof v === "bigint" ? v.toString() : v;
  }
  return JSON.stringify(obj, null, 2);
}
