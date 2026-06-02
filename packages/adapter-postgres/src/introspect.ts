/**
 * Schema introspection.
 *
 * One round-trip per concern (parallelised), grouped on the JS side into the
 * engine's `SchemaSnapshot` shape. All queries hit `pg_catalog` directly
 * because `information_schema` doesn't expose enough — notably it doesn't
 * surface comments, compound FK ordering, or index methods.
 *
 * The system schemas we exclude (`pg_catalog`, `information_schema`,
 * `pg_toast`, plus any other `pg_*`) are filtered in SQL so we never marshal
 * tens of thousands of internal rows into JS just to discard them.
 */

import type { Pool } from "pg";

import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  JsTypeHint,
  ReferentialAction,
  SchemaInfo,
  SchemaSnapshot,
  TableInfo,
  ViewInfo,
} from "@perspectives/engine";

// ============================================================================
// Queries
// ============================================================================

const SYSTEM_SCHEMA_EXCLUSION = `
  nspname NOT IN ('pg_catalog', 'information_schema')
  AND nspname NOT LIKE 'pg_%'
`;

const SCHEMAS_QUERY = `
  SELECT nspname AS schema_name
  FROM pg_namespace
  WHERE ${SYSTEM_SCHEMA_EXCLUSION}
  ORDER BY nspname
`;

const RELATIONS_QUERY = `
  SELECT
    ns.nspname                                                  AS schema,
    c.relname                                                   AS name,
    c.relkind                                                   AS kind,
    obj_description(c.oid, 'pg_class')                          AS comment,
    CASE WHEN c.relkind = 'v'::"char"
         THEN pg_get_viewdef(c.oid, true)
         ELSE NULL END                                          AS view_definition,
    CASE WHEN c.reltuples >= 0
         THEN c.reltuples::bigint
         ELSE NULL END                                          AS estimated_row_count
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE c.relkind IN ('r','v','m')
    AND ${SYSTEM_SCHEMA_EXCLUSION.replace(/nspname/g, "ns.nspname")}
  ORDER BY ns.nspname, c.relname
`;

const COLUMNS_QUERY = `
  SELECT
    ns.nspname                                          AS schema,
    c.relname                                           AS table_name,
    att.attname                                         AS column_name,
    att.attnum                                          AS position,
    format_type(att.atttypid, att.atttypmod)            AS data_type,
    t.typname                                           AS native_type,
    t.typcategory                                       AS native_category,
    NOT att.attnotnull                                  AS nullable,
    pg_get_expr(d.adbin, d.adrelid)                     AS default_expr,
    col_description(c.oid, att.attnum)                  AS comment
  FROM pg_attribute att
  JOIN pg_class c ON c.oid = att.attrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  JOIN pg_type t ON t.oid = att.atttypid
  LEFT JOIN pg_attrdef d ON d.adrelid = att.attrelid AND d.adnum = att.attnum
  WHERE att.attnum > 0
    AND NOT att.attisdropped
    AND c.relkind IN ('r','v','m')
    AND ${SYSTEM_SCHEMA_EXCLUSION.replace(/nspname/g, "ns.nspname")}
  ORDER BY ns.nspname, c.relname, att.attnum
`;

const PRIMARY_KEYS_QUERY = `
  SELECT
    ns.nspname AS schema,
    c.relname  AS table_name,
    att.attname AS column_name,
    k.ordinality AS position
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ordinality)
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
  WHERE con.contype = 'p'
    AND ${SYSTEM_SCHEMA_EXCLUSION.replace(/nspname/g, "ns.nspname")}
  ORDER BY ns.nspname, c.relname, k.ordinality
`;

const FOREIGN_KEYS_QUERY = `
  SELECT
    fk.fk_name,
    fk.from_schema,
    fk.from_table,
    fk.to_schema,
    fk.to_table,
    fk.on_update,
    fk.on_delete,
    k.ordinality AS position,
    from_col.attname AS from_column,
    to_col.attname AS to_column
  FROM (
    SELECT
      con.conname  AS fk_name,
      con.confupdtype AS on_update,
      con.confdeltype AS on_delete,
      ns.nspname  AS from_schema,
      tbl.relname AS from_table,
      con.conrelid AS from_oid,
      ns2.nspname AS to_schema,
      tbl2.relname AS to_table,
      con.confrelid AS to_oid,
      con.conkey,
      con.confkey
    FROM pg_constraint con
    JOIN pg_class tbl ON tbl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_class tbl2 ON tbl2.oid = con.confrelid
    JOIN pg_namespace ns2 ON ns2.oid = tbl2.relnamespace
    WHERE con.contype = 'f'
      AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
      AND ns.nspname NOT LIKE 'pg_%'
  ) fk
  CROSS JOIN LATERAL unnest(fk.conkey, fk.confkey) WITH ORDINALITY AS k(from_attnum, to_attnum, ordinality)
  JOIN pg_attribute from_col ON from_col.attrelid = fk.from_oid AND from_col.attnum = k.from_attnum
  JOIN pg_attribute to_col   ON to_col.attrelid   = fk.to_oid   AND to_col.attnum   = k.to_attnum
  ORDER BY fk.from_schema, fk.from_table, fk.fk_name, k.ordinality
`;

const INDEXES_QUERY = `
  SELECT
    ns.nspname               AS schema,
    tbl.relname              AS table_name,
    idx_class.relname        AS index_name,
    i.indisunique            AS is_unique,
    i.indisprimary           AS is_primary,
    am.amname                AS method,
    att.attname              AS column_name,
    k.ordinality             AS position
  FROM pg_index i
  JOIN pg_class idx_class ON idx_class.oid = i.indexrelid
  JOIN pg_class tbl       ON tbl.oid       = i.indrelid
  JOIN pg_namespace ns    ON ns.oid        = tbl.relnamespace
  JOIN pg_am am           ON am.oid        = idx_class.relam
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
  JOIN pg_attribute att   ON att.attrelid = i.indrelid AND att.attnum = k.attnum
  WHERE ${SYSTEM_SCHEMA_EXCLUSION.replace(/nspname/g, "ns.nspname")}
    AND k.attnum > 0
  ORDER BY ns.nspname, tbl.relname, idx_class.relname, k.ordinality
`;

// ============================================================================
// Row types — kept narrow so we can be strict on access
// ============================================================================

interface SchemaRow {
  schema_name: string;
}

interface RelationRow {
  schema: string;
  name: string;
  kind: "r" | "v" | "m";
  comment: string | null;
  view_definition: string | null;
  estimated_row_count: string | null; // bigint comes back as a string from pg
}

interface ColumnRow {
  schema: string;
  table_name: string;
  column_name: string;
  position: number;
  data_type: string;
  native_type: string;
  native_category: string;
  nullable: boolean;
  default_expr: string | null;
  comment: string | null;
}

interface PrimaryKeyRow {
  schema: string;
  table_name: string;
  column_name: string;
  position: string;
}

interface ForeignKeyRow {
  fk_name: string;
  from_schema: string;
  from_table: string;
  to_schema: string;
  to_table: string;
  on_update: string; // single char
  on_delete: string;
  position: string;
  from_column: string;
  to_column: string;
}

interface IndexRow {
  schema: string;
  table_name: string;
  index_name: string;
  is_unique: boolean;
  is_primary: boolean;
  method: string;
  column_name: string;
  position: string;
}

// ============================================================================
// Public entry point
// ============================================================================

export async function introspect(pool: Pool): Promise<SchemaSnapshot> {
  const [schemas, relations, columns, primaryKeys, foreignKeys, indexes] =
    await Promise.all([
      pool.query<SchemaRow>(SCHEMAS_QUERY),
      pool.query<RelationRow>(RELATIONS_QUERY),
      pool.query<ColumnRow>(COLUMNS_QUERY),
      pool.query<PrimaryKeyRow>(PRIMARY_KEYS_QUERY),
      pool.query<ForeignKeyRow>(FOREIGN_KEYS_QUERY),
      pool.query<IndexRow>(INDEXES_QUERY),
    ]);

  return assembleSnapshot({
    schemaRows: schemas.rows,
    relationRows: relations.rows,
    columnRows: columns.rows,
    primaryKeyRows: primaryKeys.rows,
    foreignKeyRows: foreignKeys.rows,
    indexRows: indexes.rows,
  });
}

// ============================================================================
// Assembly
// ============================================================================

interface RawInput {
  schemaRows: SchemaRow[];
  relationRows: RelationRow[];
  columnRows: ColumnRow[];
  primaryKeyRows: PrimaryKeyRow[];
  foreignKeyRows: ForeignKeyRow[];
  indexRows: IndexRow[];
}

function key(schema: string, name: string): string {
  return `${schema} ${name}`;
}

function assembleSnapshot(raw: RawInput): SchemaSnapshot {
  // Group columns by their owning relation.
  const columnsByRelation = new Map<string, ColumnInfo[]>();
  for (const row of raw.columnRows) {
    const list = getOrCreate(columnsByRelation, key(row.schema, row.table_name));
    list.push({
      name: row.column_name,
      dataType: row.data_type,
      jsType: mapJsType(row.native_type, row.native_category),
      nullable: row.nullable,
      ...(row.default_expr !== null ? { default: row.default_expr } : {}),
      position: row.position,
      ...(row.comment !== null ? { comment: row.comment } : {}),
    });
  }

  // Group primary-key columns by relation, preserving column order.
  const primaryKeyByRelation = new Map<string, string[]>();
  for (const row of raw.primaryKeyRows) {
    const list = getOrCreate(primaryKeyByRelation, key(row.schema, row.table_name));
    list.push(row.column_name);
  }

  // Group FK rows by `(from_schema, from_table, fk_name)` so compound keys
  // collapse into a single ForeignKeyInfo with column arrays in conkey order.
  const fkAccumulator = new Map<
    string,
    {
      info: Omit<ForeignKeyInfo, "from" | "to"> & {
        from: ForeignKeyInfo["from"];
        to: ForeignKeyInfo["to"];
      };
      relationKey: string;
    }
  >();
  for (const row of raw.foreignKeyRows) {
    const relationKey = key(row.from_schema, row.from_table);
    const fkKey = `${relationKey} ${row.fk_name}`;
    let entry = fkAccumulator.get(fkKey);
    if (!entry) {
      const onUpdate = mapReferentialAction(row.on_update);
      const onDelete = mapReferentialAction(row.on_delete);
      entry = {
        relationKey,
        info: {
          name: row.fk_name,
          from: {
            schema: row.from_schema,
            table: row.from_table,
            columns: [],
          },
          to: {
            schema: row.to_schema,
            table: row.to_table,
            columns: [],
          },
          ...(onUpdate !== undefined ? { onUpdate } : {}),
          ...(onDelete !== undefined ? { onDelete } : {}),
        },
      };
      fkAccumulator.set(fkKey, entry);
    }
    entry.info.from.columns.push(row.from_column);
    entry.info.to.columns.push(row.to_column);
  }
  const foreignKeysByRelation = new Map<string, ForeignKeyInfo[]>();
  for (const { relationKey, info } of fkAccumulator.values()) {
    getOrCreate(foreignKeysByRelation, relationKey).push(info);
  }

  // Indexes: similar group-by, with array columns assembled in indkey order.
  const indexAccumulator = new Map<
    string,
    {
      info: IndexInfo;
      relationKey: string;
    }
  >();
  for (const row of raw.indexRows) {
    const relationKey = key(row.schema, row.table_name);
    const idxKey = `${row.schema} ${row.table_name} ${row.index_name}`;
    let entry = indexAccumulator.get(idxKey);
    if (!entry) {
      entry = {
        relationKey,
        info: {
          name: row.index_name,
          schema: row.schema,
          table: row.table_name,
          columns: [],
          unique: row.is_unique,
          isPrimary: row.is_primary,
          ...(row.method ? { method: row.method } : {}),
        },
      };
      indexAccumulator.set(idxKey, entry);
    }
    entry.info.columns.push(row.column_name);
  }
  const indexesByRelation = new Map<string, IndexInfo[]>();
  for (const { relationKey, info } of indexAccumulator.values()) {
    getOrCreate(indexesByRelation, relationKey).push(info);
  }

  // Tables (relkind r, m) and views (relkind v) grouped by schema.
  const tablesBySchema = new Map<string, TableInfo[]>();
  const viewsBySchema = new Map<string, ViewInfo[]>();
  for (const row of raw.relationRows) {
    const relationKey = key(row.schema, row.name);
    const cols = columnsByRelation.get(relationKey) ?? [];
    if (row.kind === "v") {
      const view: ViewInfo = {
        schema: row.schema,
        name: row.name,
        columns: cols,
        ...(row.view_definition !== null ? { definition: row.view_definition } : {}),
        ...(row.comment !== null ? { comment: row.comment } : {}),
      };
      getOrCreate(viewsBySchema, row.schema).push(view);
      continue;
    }
    const pk = primaryKeyByRelation.get(relationKey);
    const table: TableInfo = {
      schema: row.schema,
      name: row.name,
      kind: row.kind === "m" ? "materialized_view" : "table",
      columns: cols,
      ...(pk !== undefined ? { primaryKey: pk } : {}),
      foreignKeys: foreignKeysByRelation.get(relationKey) ?? [],
      indexes: indexesByRelation.get(relationKey) ?? [],
      ...(row.estimated_row_count !== null
        ? { estimatedRowCount: Number(row.estimated_row_count) }
        : {}),
      ...(row.comment !== null ? { comment: row.comment } : {}),
    };
    getOrCreate(tablesBySchema, row.schema).push(table);
  }

  const schemas: SchemaInfo[] = raw.schemaRows.map((row) => {
    const tables = tablesBySchema.get(row.schema_name) ?? [];
    const views = viewsBySchema.get(row.schema_name);
    const info: SchemaInfo = {
      name: row.schema_name,
      tables,
      ...(views !== undefined && views.length > 0 ? { views } : {}),
    };
    return info;
  });

  return {
    fetchedAt: new Date().toISOString(),
    schemas,
  };
}

// ============================================================================
// Mappers
// ============================================================================

/**
 * Postgres native type → coarse JS-side hint. Driven by `pg_type.typname` and
 * `pg_type.typcategory` so we don't have to enumerate every domain / extension
 * type. Array categories ('A') always map to "array" regardless of element.
 */
function mapJsType(nativeType: string, nativeCategory: string): JsTypeHint {
  if (nativeCategory === "A") return "array";
  switch (nativeType) {
    case "text":
    case "varchar":
    case "bpchar":
    case "char":
    case "name":
    case "citext":
      return "string";
    case "int2":
    case "int4":
    case "float4":
    case "float8":
    case "numeric":
      return "number";
    case "int8":
      return "bigint";
    case "bool":
      return "boolean";
    case "timestamp":
    case "timestamptz":
      return "datetime";
    case "date":
      return "date";
    case "time":
    case "timetz":
      return "time";
    case "interval":
      return "interval";
    case "json":
    case "jsonb":
      return "json";
    case "bytea":
      return "bytes";
    case "uuid":
      return "uuid";
    default:
      return "unknown";
  }
}

function mapReferentialAction(code: string): ReferentialAction | undefined {
  switch (code) {
    case "a":
      return "no action";
    case "r":
      return "restrict";
    case "c":
      return "cascade";
    case "n":
      return "set null";
    case "d":
      return "set default";
    default:
      return undefined;
  }
}

function getOrCreate<K, V>(map: Map<K, V[]>, key: K): V[] {
  let value = map.get(key);
  if (!value) {
    value = [];
    map.set(key, value);
  }
  return value;
}
