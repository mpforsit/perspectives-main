import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  SchemaInfo,
  SchemaSnapshot,
  TableInfo,
} from "@perspectives/engine";

import { PostgresAdapter } from "../src";
import { withSeededPostgres } from "./helpers/container";

const handle = withSeededPostgres();

let adapter: PostgresAdapter;
let snapshot: SchemaSnapshot;
let publicSchema: SchemaInfo;

function findTable(name: string): TableInfo {
  const table = publicSchema.tables.find((t) => t.name === name);
  if (!table) {
    throw new Error(`Expected the public schema to contain table "${name}"`);
  }
  return table;
}

beforeAll(async () => {
  adapter = new PostgresAdapter(handle.profile);
  snapshot = await adapter.introspect();
  const found = snapshot.schemas.find((s) => s.name === "public");
  if (!found) {
    throw new Error('Expected snapshot to include a "public" schema');
  }
  publicSchema = found;
});

afterAll(async () => {
  await adapter.close();
});

describe("PostgresAdapter.introspect — comments", () => {
  it("captures the customers table comment", () => {
    const customers = findTable("customers");
    expect(customers.comment).toBe("End customers of the business.");
  });

  it("captures the customers.lifetime_value column comment", () => {
    const customers = findTable("customers");
    const ltv = customers.columns.find((c) => c.name === "lifetime_value");
    expect(ltv).toBeDefined();
    expect(ltv?.comment).toBe(
      "Total revenue from this customer, in USD.",
    );
  });
});

describe("PostgresAdapter.introspect — foreign keys", () => {
  it("represents the compound FK inventory_warehouse_fk in column order", () => {
    const inventory = findTable("inventory");
    const fk = inventory.foreignKeys.find(
      (f) => f.name === "inventory_warehouse_fk",
    );
    expect(fk).toBeDefined();
    expect(fk?.from.columns).toEqual(["tenant_id", "warehouse_code"]);
    expect(fk?.to.schema).toBe("public");
    expect(fk?.to.table).toBe("warehouses");
    expect(fk?.to.columns).toEqual(["tenant_id", "code"]);
  });

  it("preserves the self-referential FK on employees.manager_id", () => {
    const employees = findTable("employees");
    const selfFk = employees.foreignKeys.find(
      (f) => f.from.columns.length === 1 && f.from.columns[0] === "manager_id",
    );
    expect(selfFk).toBeDefined();
    expect(selfFk?.to.schema).toBe("public");
    expect(selfFk?.to.table).toBe("employees");
    expect(selfFk?.to.columns).toEqual(["id"]);
  });
});

describe("PostgresAdapter.introspect — views vs tables", () => {
  it("classifies active_customers as a view, not a table", () => {
    expect(
      publicSchema.tables.find((t) => t.name === "active_customers"),
    ).toBeUndefined();
    const view = publicSchema.views?.find((v) => v.name === "active_customers");
    expect(view).toBeDefined();
    expect(view?.columns.map((c) => c.name)).toEqual([
      "id",
      "full_name",
      "email",
      "country_code",
    ]);
    expect(view?.definition).toContain("FROM customers");
  });
});

describe("PostgresAdapter.introspect — primary keys", () => {
  it("returns customer_tags' compound primary key in declaration order", () => {
    const customerTags = findTable("customer_tags");
    expect(customerTags.primaryKey).toEqual(["customer_id", "tag_id"]);
  });
});
