import { describe, it, expect } from "vitest";
import {
  PerspectiveDef,
  DisplayConfig,
  validatePerspective,
  validateRelation,
} from "../src/schemas";

// ============================================================================
// Sample relation ids used across tests (ULIDs are 26 chars).
// ============================================================================
const REL_CUSTOMER_COMPANY    = "01JBC0M0ZK0M0M0M0M0M0M0M0M";
const REL_ORDERITEM_ORDER     = "01JBC1M0ZK0M0M0M0M0M0M0M0M";
const REL_ORDERITEM_PRODUCT   = "01JBC2M0ZK0M0M0M0M0M0M0M0M";
const REL_ORDER_CUSTOMER      = "01JBC3M0ZK0M0M0M0M0M0M0M0M";
const REL_EMPLOYEE_MANAGER    = "01JBC4M0ZK0M0M0M0M0M0M0M0M";

const validPerspective = {
  id: "01J9X2KZQ5N7P3VCM8B4ETRGYH",
  name: "Active EU customers — last 30d",
  description: "Customers in EU countries with a recent order.",
  base: { kind: "table", schema: "public", table: "customers" },
  columns: [
    { source: { column: "id" }, readonly: true, width: 80 },
    { source: { column: "full_name" } },
    { source: { column: "email" } },
    { source: { column: "country_code" }, alias: "country" },
    {
      source: {
        computed: "EXTRACT(DAY FROM now() - last_login_at)::int",
      },
      alias: "days_since_login",
    },
  ],
  sort: [{ column: "days_since_login", direction: "asc" }],
  filters: {
    op: "and",
    children: [
      {
        column: "country_code",
        op: "in",
        value: ["DE", "FR", "NL", "IT", "ES", "PL"],
      },
      {
        column: "last_order_at",
        op: "gte",
        value: { kind: "today", offset: -30 },
      },
    ],
  },
  filterBar: {
    visible: [
      { column: "country_code", label: "Country" },
      { column: "email", label: "Email contains", defaultOp: "ilike" },
    ],
    collapsed: [],
  },
  defaultPageSize: 100,
  createdBy: "user_01J9X2KZQ5N7P3VCM8B4ETRGYH",
  updatedAt: "2026-05-27T09:00:00Z",
  version: 1,
  trustedSql: true,
};

// ============================================================================
// PerspectiveDef — baseline
// ============================================================================
describe("PerspectiveDef — baseline", () => {
  it("accepts a complete single-table perspective", () => {
    const result = validatePerspective(validPerspective);
    expect(result.ok).toBe(true);
  });

  it("strips unknown top-level fields", () => {
    const result = validatePerspective({
      ...validPerspective,
      randomGarbage: "should be removed",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("randomGarbage" in result.value).toBe(false);
    }
  });

  it("rejects a perspective with a missing required field", () => {
    const { id: _id, ...rest } = validPerspective;
    const result = validatePerspective(rest);
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid ULID", () => {
    const result = validatePerspective({
      ...validPerspective,
      id: "not-a-ulid",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts deeply nested filter groups", () => {
    const result = validatePerspective({
      ...validPerspective,
      filters: {
        op: "or",
        children: [
          {
            op: "and",
            children: [
              { column: "country_code", op: "eq", value: "DE" },
              { column: "tier", op: "in", value: ["gold", "platinum"] },
            ],
          },
          {
            op: "and",
            children: [
              { column: "country_code", op: "eq", value: "FR" },
              {
                op: "or",
                children: [
                  { column: "tier", op: "eq", value: "platinum" },
                  { column: "lifetime_value", op: "gte", value: 10000 },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });

  it("supports SQL perspectives with parameters", () => {
    const result = validatePerspective({
      ...validPerspective,
      base: {
        kind: "sql",
        query:
          "SELECT c.*, COUNT(o.id) AS order_count FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id HAVING COUNT(o.id) > $1",
        parameters: [
          { name: "min_orders", type: "number", default: 0, required: true },
        ],
      },
      columns: [
        { source: { column: "id" } },
        { source: { column: "full_name" } },
        { source: { column: "order_count" } },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("supports currentUser dynamic value in row filter", () => {
    const result = validatePerspective({
      ...validPerspective,
      permissions: {
        read: "rule",
        insert: "deny",
        update: "columns",
        delete: "deny",
        rowFilter: {
          op: "and",
          children: [
            { column: "assignee_id", op: "eq", value: { kind: "currentUser" } },
          ],
        },
        columnRules: {
          notes: { read: true, write: true },
          email: { read: true, write: false },
        },
      },
    });
    expect(result.ok).toBe(true);
  });
});

// ============================================================================
// PerspectiveDef — joins
// ============================================================================
describe("PerspectiveDef — joins", () => {
  it("accepts a perspective with one n:1 join (customer + company name)", () => {
    const result = validatePerspective({
      ...validPerspective,
      base: {
        kind: "table",
        schema: "public",
        table: "customers",
        joins: [{ alias: "company", via: REL_CUSTOMER_COMPANY, type: "left" }],
      },
      columns: [
        { source: { column: "id" }, width: 80, readonly: true },
        { source: { column: "full_name" } },
        {
          source: { joinAlias: "company", column: "name" },
          alias: "company_name",
        },
        {
          source: { joinAlias: "company", column: "industry" },
          alias: "company_industry",
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a multi-hop join chain (order items → order → customer)", () => {
    const result = validatePerspective({
      ...validPerspective,
      base: {
        kind: "table",
        schema: "public",
        table: "order_items",
        joins: [
          { alias: "order", via: REL_ORDERITEM_ORDER, type: "inner" },
          { alias: "product", via: REL_ORDERITEM_PRODUCT, type: "left" },
          {
            alias: "customer",
            via: REL_ORDER_CUSTOMER,
            fromAlias: "order",
            type: "left",
          },
        ],
      },
      columns: [
        { source: { column: "id" } },
        { source: { column: "quantity" } },
        {
          source: { joinAlias: "product", column: "name" },
          alias: "product_name",
        },
        {
          source: { joinAlias: "customer", column: "email" },
          alias: "customer_email",
        },
      ],
      sort: [{ column: "id", direction: "asc" }],
      filters: { op: "and", children: [] },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts filters that reference joined columns", () => {
    const result = validatePerspective({
      ...validPerspective,
      base: {
        kind: "table",
        schema: "public",
        table: "customers",
        joins: [{ alias: "company", via: REL_CUSTOMER_COMPANY, type: "left" }],
      },
      filters: {
        op: "and",
        children: [
          {
            joinAlias: "company",
            column: "country_code",
            op: "eq",
            value: "DE",
          },
          { column: "is_active", op: "eq", value: true },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts sort on a joined column", () => {
    const result = validatePerspective({
      ...validPerspective,
      base: {
        kind: "table",
        schema: "public",
        table: "customers",
        joins: [{ alias: "company", via: REL_CUSTOMER_COMPANY, type: "left" }],
      },
      sort: [
        { joinAlias: "company", column: "name", direction: "asc" },
        { column: "full_name", direction: "asc" },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts filter-bar fields referencing joined columns", () => {
    const result = validatePerspective({
      ...validPerspective,
      base: {
        kind: "table",
        schema: "public",
        table: "customers",
        joins: [{ alias: "company", via: REL_CUSTOMER_COMPANY, type: "left" }],
      },
      filterBar: {
        visible: [
          {
            joinAlias: "company",
            column: "country_code",
            label: "Company country",
          },
          { column: "email", label: "Email contains", defaultOp: "ilike" },
        ],
        collapsed: [],
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a self-referential join with explicit direction (employee + manager)", () => {
    const result = validatePerspective({
      ...validPerspective,
      base: {
        kind: "table",
        schema: "public",
        table: "employees",
        joins: [
          {
            alias: "manager",
            via: REL_EMPLOYEE_MANAGER,
            direction: "forward",
            type: "left",
          },
        ],
      },
      columns: [
        { source: { column: "id" } },
        { source: { column: "full_name" } },
        {
          source: { joinAlias: "manager", column: "full_name" },
          alias: "manager_name",
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a join with an additional filter on the joined side", () => {
    const result = validatePerspective({
      ...validPerspective,
      base: {
        kind: "table",
        schema: "public",
        table: "customers",
        joins: [
          {
            alias: "active_subscription",
            via: REL_CUSTOMER_COMPANY,
            type: "left",
            filter: {
              op: "and",
              children: [
                { column: "status", op: "eq", value: "active" },
                {
                  column: "expires_at",
                  op: "gt",
                  value: { kind: "today" },
                },
              ],
            },
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a join with an invalid `via` (non-ULID)", () => {
    const result = validatePerspective({
      ...validPerspective,
      base: {
        kind: "table",
        schema: "public",
        table: "customers",
        joins: [{ alias: "company", via: "not-a-ulid", type: "left" }],
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a join missing the required alias field", () => {
    const result = validatePerspective({
      ...validPerspective,
      base: {
        kind: "table",
        schema: "public",
        table: "customers",
        joins: [{ via: REL_CUSTOMER_COMPANY, type: "left" } as unknown],
      },
    });
    expect(result.ok).toBe(false);
  });

  it("applies the default join type of `left` when type is omitted", () => {
    const result = validatePerspective({
      ...validPerspective,
      base: {
        kind: "table",
        schema: "public",
        table: "customers",
        joins: [{ alias: "company", via: REL_CUSTOMER_COMPANY }],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.base.kind === "table") {
      expect(result.value.base.joins?.[0]?.type).toBe("left");
    }
  });
});

// ============================================================================
// ColumnSource strictness
// ============================================================================
describe("ColumnSource — strictness", () => {
  it("rejects a column source that mixes `column` and `joinAlias` with extra keys", () => {
    const result = validatePerspective({
      ...validPerspective,
      columns: [
        {
          source: {
            column: "x",
            joinAlias: "y",
            garbage: true,
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a column source that combines `column` and `computed`", () => {
    const result = validatePerspective({
      ...validPerspective,
      columns: [
        {
          source: {
            column: "x",
            computed: "1 + 1",
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a column source with `joinAlias` but no `column`", () => {
    const result = validatePerspective({
      ...validPerspective,
      columns: [
        {
          source: {
            joinAlias: "company",
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

// ============================================================================
// Trusted-SQL boundary — see AUDIT-CODEX.md finding #5.
// ============================================================================
describe("PerspectiveDef — trustedSql boundary", () => {
  it("rejects a `computed` column when trustedSql is absent (the safe default)", () => {
    const result = validatePerspective({
      ...validPerspective,
      trustedSql: undefined,
      columns: [
        { source: { column: "id" } },
        { source: { computed: "1+1" }, alias: "two" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.issues[0]?.path).toEqual([
        "columns",
        1,
        "source",
        "computed",
      ]);
    }
  });

  it("rejects a `computed` column when trustedSql is explicitly false", () => {
    const result = validatePerspective({
      ...validPerspective,
      trustedSql: false,
      columns: [
        { source: { column: "id" } },
        { source: { computed: "1+1" }, alias: "two" },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a SQL-base perspective when trustedSql is false", () => {
    const result = validatePerspective({
      ...validPerspective,
      trustedSql: false,
      base: { kind: "sql", query: "SELECT 1 AS one" },
      columns: [{ source: { column: "one" } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.issues[0]?.path).toEqual(["base", "kind"]);
    }
  });

  it("accepts `computed` columns when trustedSql is true", () => {
    const result = validatePerspective({
      ...validPerspective,
      trustedSql: true,
      columns: [
        { source: { column: "id" } },
        { source: { computed: "1+1" }, alias: "two" },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a non-raw-SQL perspective whether trustedSql is set or not", () => {
    const safe = {
      ...validPerspective,
      columns: [{ source: { column: "id" } }],
    };
    expect(validatePerspective({ ...safe, trustedSql: undefined }).ok).toBe(true);
    expect(validatePerspective({ ...safe, trustedSql: false }).ok).toBe(true);
    expect(validatePerspective({ ...safe, trustedSql: true }).ok).toBe(true);
  });
});

// ============================================================================
// RelationDef
// ============================================================================
describe("RelationDef", () => {
  const baseValid = {
    id: "01J9X2KZQ5N7P3VCM8B4ETRGYJ",
    from: { schema: "public", table: "customers", columns: ["id"] },
    to: { schema: "public", table: "orders", columns: ["customer_id"] },
    cardinality: "one-to-many" as const,
    source: "schema" as const,
    displayDirection: "both" as const,
    updatedAt: "2026-05-27T09:00:00Z",
  };

  it("accepts a simple 1:n relation", () => {
    const result = validateRelation(baseValid);
    expect(result.ok).toBe(true);
  });

  it("accepts a many-to-many relation with a junction", () => {
    const result = validateRelation({
      ...baseValid,
      cardinality: "many-to-many",
      junction: {
        schema: "public",
        table: "customer_tags",
        fromCols: ["customer_id"],
        toCols: ["tag_id"],
      },
      to: { schema: "public", table: "tags", columns: ["id"] },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a many-to-many relation without a junction", () => {
    const result = validateRelation({
      ...baseValid,
      cardinality: "many-to-many",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects mismatched column counts in non-m2m relations", () => {
    const result = validateRelation({
      ...baseValid,
      from: {
        schema: "public",
        table: "customers",
        columns: ["tenant_id", "id"],
      },
      to: { schema: "public", table: "orders", columns: ["customer_id"] },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a compound foreign key relation", () => {
    const result = validateRelation({
      ...baseValid,
      from: {
        schema: "public",
        table: "customers",
        columns: ["tenant_id", "id"],
      },
      to: {
        schema: "public",
        table: "orders",
        columns: ["tenant_id", "customer_id"],
      },
    });
    expect(result.ok).toBe(true);
  });
});

// ============================================================================
// DisplayConfig
// ============================================================================
describe("DisplayConfig", () => {
  it("accepts a basic config", () => {
    const result = DisplayConfig.safeParse({
      schema: "public",
      table: "users",
      displayColumn: "full_name",
      updatedAt: "2026-05-27T09:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a row label template", () => {
    const result = DisplayConfig.safeParse({
      schema: "public",
      table: "users",
      displayColumn: "id",
      secondaryColumn: "email",
      rowLabelTemplate: "{first_name} {last_name}",
      updatedAt: "2026-05-27T09:00:00Z",
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Type inference smoke test
// ============================================================================
describe("PerspectiveDef.parse (type inference smoke test)", () => {
  it("infers a typed value the compiler can narrow on", () => {
    const parsed = PerspectiveDef.parse(validPerspective);
    if (parsed.base.kind === "table") {
      expect(parsed.base.schema).toBe("public");
      expect(parsed.base.table).toBe("customers");
    }
  });

  it("infers join types under narrowing", () => {
    const parsed = PerspectiveDef.parse({
      ...validPerspective,
      base: {
        kind: "table",
        schema: "public",
        table: "customers",
        joins: [{ alias: "company", via: "01JBC0M0ZK0M0M0M0M0M0M0M0M" }],
      },
    });
    if (parsed.base.kind === "table") {
      expect(parsed.base.joins?.[0]?.alias).toBe("company");
      expect(parsed.base.joins?.[0]?.type).toBe("left"); // default applied
    }
  });
});
