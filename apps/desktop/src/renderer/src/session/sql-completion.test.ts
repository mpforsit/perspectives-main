import { describe, expect, it } from "vitest";

import type { SchemaSnapshot } from "@perspectives/engine";

import { buildSqlSchemaMap } from "./sql-completion";

function snap(): SchemaSnapshot {
  return {
    fetchedAt: "2026-06-02T00:00:00Z",
    schemas: [
      {
        name: "public",
        tables: [
          {
            schema: "public",
            name: "customers",
            kind: "table",
            columns: [
              { name: "id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
              { name: "email", dataType: "text", jsType: "string", nullable: true, position: 2 },
            ],
            foreignKeys: [],
            indexes: [],
          },
        ],
        views: [
          {
            schema: "public",
            name: "active_users",
            columns: [
              { name: "user_id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
            ],
          },
        ],
      },
      {
        name: "audit",
        tables: [
          {
            schema: "audit",
            name: "customers",
            kind: "table",
            columns: [
              { name: "id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
              { name: "changed_at", dataType: "timestamptz", jsType: "datetime", nullable: false, position: 2 },
            ],
            foreignKeys: [],
            indexes: [],
          },
        ],
      },
    ],
  };
}

describe("buildSqlSchemaMap", () => {
  it("returns an empty map when no snapshot is available", () => {
    expect(buildSqlSchemaMap(undefined)).toEqual({});
  });

  it("emits schema-qualified entries for every table and view", () => {
    const out = buildSqlSchemaMap(snap());
    expect(out["public.customers"]).toEqual(["id", "email"]);
    expect(out["audit.customers"]).toEqual(["id", "changed_at"]);
    expect(out["public.active_users"]).toEqual(["user_id"]);
  });

  it("emits the bare table name only when it's unambiguous", () => {
    const out = buildSqlSchemaMap(snap());
    // "customers" exists in both schemas → bare form must be absent.
    expect(out["customers"]).toBeUndefined();
    // "active_users" is unique → bare form is present.
    expect(out["active_users"]).toEqual(["user_id"]);
  });
});
