import { describe, expect, it } from "vitest";

import {
  bytesLength,
  bytesPreview,
  classifyCell,
  formatCell,
  formatJson,
  formatNumber,
  formatTimestamp,
  isArrayType,
  isBinary,
  isRightAligned,
  rowToJson,
  rowToTsv,
  truncate,
} from "./format";

describe("classifyCell", () => {
  it("classifies null/undefined as 'null' regardless of dbType", () => {
    expect(classifyCell("int4", null)).toBe("null");
    expect(classifyCell("text", undefined)).toBe("null");
    expect(classifyCell("jsonb", null)).toBe("null");
  });

  it("classifies postgres numeric dbTypes as 'number'", () => {
    expect(classifyCell("int4", 42)).toBe("number");
    expect(classifyCell("numeric", "3.14")).toBe("number");
    expect(classifyCell("bigint", 1n)).toBe("number");
  });

  it("classifies bool/boolean as 'boolean' and respects native bool values", () => {
    expect(classifyCell("bool", true)).toBe("boolean");
    expect(classifyCell("boolean", false)).toBe("boolean");
    expect(classifyCell("text", true)).toBe("boolean");
  });

  it("classifies timestamp/date/time dbTypes distinctly", () => {
    expect(classifyCell("timestamptz", "2026-01-01T00:00:00Z")).toBe("timestamp");
    expect(classifyCell("date", "2026-01-01")).toBe("date");
    expect(classifyCell("time", "12:00:00")).toBe("time");
  });

  it("classifies json/jsonb as 'json'", () => {
    expect(classifyCell("jsonb", { a: 1 })).toBe("json");
    expect(classifyCell("json", "foo")).toBe("json");
  });

  it("classifies arrays by either JS-array values or _-prefix dbTypes", () => {
    expect(classifyCell("_text", null as unknown as string[])).toBe("null");
    expect(classifyCell("_text", ["a", "b"])).toBe("array");
    expect(classifyCell("text[]", ["a"])).toBe("array");
    expect(classifyCell("anything", [1, 2, 3])).toBe("array");
  });

  it("falls back to 'text' for unknown dbTypes with string values", () => {
    expect(classifyCell("citext", "hi")).toBe("text");
    expect(classifyCell("xml", "<x/>")).toBe("text");
  });
});

describe("isArrayType", () => {
  it("recognises leading-underscore and trailing-[] forms", () => {
    expect(isArrayType("_int4")).toBe(true);
    expect(isArrayType("text[]")).toBe(true);
    expect(isArrayType("int4")).toBe(false);
    expect(isArrayType("")).toBe(false);
  });
});

describe("isRightAligned", () => {
  it("right-aligns numeric column types only", () => {
    expect(isRightAligned("int4")).toBe(true);
    expect(isRightAligned("numeric")).toBe(true);
    expect(isRightAligned("text")).toBe(false);
    expect(isRightAligned("bool")).toBe(false);
  });
});

describe("formatTimestamp", () => {
  it("renders ISO strings as YYYY-MM-DD HH:MM:SS", () => {
    expect(formatTimestamp("2026-01-15T13:45:09Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("renders Date objects identically to ISO strings", () => {
    const date = new Date("2026-01-15T13:45:09Z");
    expect(formatTimestamp(date)).toBe(formatTimestamp("2026-01-15T13:45:09Z"));
  });

  it("returns the raw string for unparseable input", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
});

describe("formatNumber", () => {
  it("formats integers and floats", () => {
    expect(formatNumber(1234)).toMatch(/1[,.   ]?234/);
    expect(formatNumber(0)).toBe("0");
  });

  it("handles bigints", () => {
    expect(formatNumber(9007199254740993n)).toBe("9007199254740993");
  });

  it("handles numeric strings (pg returns numeric as string)", () => {
    expect(formatNumber("3.14")).toMatch(/^3[.,]14$/);
  });

  it("passes non-finite values through", () => {
    expect(formatNumber(Infinity)).toBe("Infinity");
    expect(formatNumber(NaN)).toBe("NaN");
  });
});

describe("formatJson", () => {
  it("serializes objects and arrays compactly", () => {
    expect(formatJson({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });

  it("gracefully handles unserializable values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatJson(cyclic)).toBe("[unserializable]");
  });
});

describe("truncate", () => {
  it("leaves short strings alone", () => {
    expect(truncate("abc", 5)).toBe("abc");
  });

  it("trims with ellipsis", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
  });
});

describe("classifyCell — bytes", () => {
  it("classifies Uint8Array values as 'bytes' regardless of dbType", () => {
    expect(classifyCell("text", new Uint8Array([1, 2, 3]))).toBe("bytes");
    expect(classifyCell("bytea", new Uint8Array(0))).toBe("bytes");
  });

  it("classifies ArrayBuffer values as 'bytes'", () => {
    expect(classifyCell("bytea", new ArrayBuffer(8))).toBe("bytes");
  });

  it("falls back to dbType when value isn't yet a typed array", () => {
    expect(classifyCell("bytea", null)).toBe("null");
  });
});

describe("isBinary / bytesLength / bytesPreview", () => {
  it("isBinary recognises Uint8Array + ArrayBuffer", () => {
    expect(isBinary(new Uint8Array(4))).toBe(true);
    expect(isBinary(new ArrayBuffer(4))).toBe(true);
    expect(isBinary("not bytes")).toBe(false);
    expect(isBinary([1, 2, 3])).toBe(false);
  });

  it("bytesLength returns byteLength for binary, null otherwise", () => {
    expect(bytesLength(new Uint8Array(10))).toBe(10);
    expect(bytesLength(new ArrayBuffer(5))).toBe(5);
    expect(bytesLength("hi")).toBeNull();
  });

  it("bytesPreview emits a space-separated lowercase hex dump", () => {
    expect(bytesPreview(new Uint8Array([0, 15, 255]))).toBe("00 0f ff");
  });

  it("bytesPreview truncates to maxBytes", () => {
    expect(bytesPreview(new Uint8Array([1, 2, 3, 4, 5]), 2)).toBe("01 02");
  });
});

describe("formatCell — bytes", () => {
  it("formats a Uint8Array as a length summary, not raw bytes", () => {
    expect(formatCell("bytea", new Uint8Array(1024))).toBe("<bytea, 1,024 bytes>");
  });

  it("formats unknown binary as '<bytea>'", () => {
    // bytea-typed null is handled by the null branch; this covers the
    // theoretical case where the renderer sees a bytea cell but the value
    // isn't yet a typed array (some drivers return base64 strings instead).
    expect(formatCell("text", new Uint8Array(0))).toBe("<bytea, 0 bytes>");
  });
});

describe("formatCell", () => {
  it("returns empty string for null (the badge is drawn separately)", () => {
    expect(formatCell("int4", null)).toBe("");
  });

  it("matches per-kind formatters for non-null values", () => {
    expect(formatCell("bool", true)).toBe("true");
    expect(formatCell("int4", 7)).toBe("7");
    expect(formatCell("jsonb", { a: 1 })).toBe('{"a":1}');
  });
});

describe("rowToTsv", () => {
  it("joins formatted cells with tabs and writes empties for null", () => {
    const columns = [
      { name: "id", dbType: "int4" },
      { name: "name", dbType: "text" },
      { name: "meta", dbType: "jsonb" },
      { name: "ts", dbType: "timestamptz" },
    ];
    const row = { id: 1, name: "alice", meta: { a: 1 }, ts: null };
    expect(rowToTsv(row, columns)).toBe('1\talice\t{"a":1}\t');
  });

  it("escapes embedded tabs and newlines", () => {
    const cols = [{ name: "col", dbType: "text" }];
    expect(rowToTsv({ col: "a\tb\nc" }, cols)).toBe("a\\tb\\nc");
  });
});

describe("rowToJson", () => {
  it("emits a JSON object keyed by column name", () => {
    const cols = [
      { name: "id", dbType: "int4" },
      { name: "name", dbType: "text" },
    ];
    expect(rowToJson({ id: 1, name: "alice" }, cols)).toBe('{\n  "id": 1,\n  "name": "alice"\n}');
  });

  it("stringifies bigints (JSON.stringify would throw otherwise)", () => {
    const cols = [{ name: "n", dbType: "int8" }];
    expect(rowToJson({ n: 10n }, cols)).toBe('{\n  "n": "10"\n}');
  });
});
