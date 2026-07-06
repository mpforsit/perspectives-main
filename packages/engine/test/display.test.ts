import { describe, expect, it } from "vitest";

import {
  extractTemplateColumns,
  formatRowLabel,
  formatRowLabelWithSecondary,
} from "../src";
import type { DisplayConfig } from "@perspectives/dsl";

const NOW = "2026-06-17T00:00:00.000Z";

function config(overrides: Partial<DisplayConfig>): DisplayConfig {
  return {
    schema: "public",
    table: "customers",
    displayColumn: "full_name",
    updatedAt: NOW,
    ...overrides,
  };
}

describe("extractTemplateColumns", () => {
  it("returns the bare column names referenced in the template", () => {
    expect(extractTemplateColumns("{first_name} {last_name}")).toEqual([
      "first_name",
      "last_name",
    ]);
  });

  it("deduplicates references", () => {
    expect(extractTemplateColumns("{name} ({name})")).toEqual(["name"]);
  });

  it("preserves first-appearance order", () => {
    expect(extractTemplateColumns("{b} {a} {b} {c}")).toEqual(["b", "a", "c"]);
  });

  it("ignores literal text and partial brace pairs", () => {
    expect(extractTemplateColumns("Hello { not a placeholder")).toEqual([]);
    expect(extractTemplateColumns("Plain literal")).toEqual([]);
  });

  it("rejects names that don't look like identifiers", () => {
    expect(extractTemplateColumns("{123} {hi-there}")).toEqual([]);
  });
});

describe("formatRowLabel — template resolution", () => {
  it("substitutes {column} placeholders with row values", () => {
    const c = config({ rowLabelTemplate: "{first_name} {last_name}" });
    const label = formatRowLabel(
      { first_name: "Ada", last_name: "Lovelace" },
      ["id"],
      c,
    );
    expect(label).toBe("Ada Lovelace");
  });

  it("renders missing fields as empty (preserves surrounding literal text)", () => {
    const c = config({ rowLabelTemplate: "x: {y}" });
    expect(formatRowLabel({ y: null }, ["id"], c)).toBe("x: ");
    expect(formatRowLabel({}, ["id"], c)).toBe("x: ");
  });

  it("handles numeric / boolean / bigint values", () => {
    const c = config({ rowLabelTemplate: "#{id} active:{is_active}" });
    expect(formatRowLabel({ id: 42, is_active: true }, ["id"], c)).toBe(
      "#42 active:true",
    );
    expect(formatRowLabel({ id: 9007199254740993n, is_active: false }, ["id"], c)).toBe(
      "#9007199254740993 active:false",
    );
  });

  it("stringifies Date values via ISO format", () => {
    const c = config({ rowLabelTemplate: "{created_at}" });
    expect(formatRowLabel({ created_at: new Date("2026-06-17T00:00:00Z") }, ["id"], c)).toBe(
      "2026-06-17T00:00:00.000Z",
    );
  });
});

describe("formatRowLabel — displayColumn fallback", () => {
  it("uses displayColumn when no template is set", () => {
    expect(
      formatRowLabel(
        { full_name: "Acme Corp", country_code: "FR" },
        ["id"],
        config({ displayColumn: "full_name" }),
      ),
    ).toBe("Acme Corp");
  });

  it("renders empty string for a null displayColumn value", () => {
    expect(
      formatRowLabel(
        { full_name: null },
        ["id"],
        config({ displayColumn: "full_name" }),
      ),
    ).toBe("");
  });
});

describe("formatRowLabel — PK fallback when no config", () => {
  it("joins PK values with `·` when no DisplayConfig", () => {
    expect(formatRowLabel({ id: 42 }, ["id"], null)).toBe("42");
    expect(
      formatRowLabel(
        { tenant_id: 1, code: "A1" },
        ["tenant_id", "code"],
        null,
      ),
    ).toBe("1·A1");
  });

  it("renders ? for a missing PK value", () => {
    expect(formatRowLabel({}, ["id"], null)).toBe("?");
  });

  it("renders ? for a no-PK-no-config edge", () => {
    expect(formatRowLabel({}, [], null)).toBe("?");
  });
});

describe("formatRowLabelWithSecondary", () => {
  it("returns both lines when a secondary column is configured", () => {
    const c = config({ displayColumn: "full_name", secondaryColumn: "email" });
    expect(
      formatRowLabelWithSecondary(
        { full_name: "Ada", email: "ada@example.com" },
        ["id"],
        c,
      ),
    ).toEqual({ label: "Ada", secondary: "ada@example.com" });
  });

  it("returns secondary=null when none is configured", () => {
    const c = config({ displayColumn: "full_name" });
    expect(
      formatRowLabelWithSecondary({ full_name: "Ada" }, ["id"], c),
    ).toEqual({ label: "Ada", secondary: null });
  });

  it("returns empty-string secondary when the column value is null/missing", () => {
    const c = config({
      displayColumn: "full_name",
      secondaryColumn: "email",
    });
    expect(
      formatRowLabelWithSecondary({ full_name: "Ada", email: null }, ["id"], c),
    ).toEqual({ label: "Ada", secondary: "" });
  });
});
