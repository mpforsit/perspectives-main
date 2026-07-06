export * from "./adapter";
export * from "./metadata";
export * from "./audit";
export * from "./display";
export * from "./errors";
export * from "./junctions";
export * from "./relations";
export * from "./service";

// Re-export DSL types so adapter / store packages can pull everything they
// need from a single `@perspectives/engine` import. The DSL stays the source
// of truth; this is a convenience surface, not a parallel definition.
export type {
  ColumnDef,
  ColumnSource,
  DisplayConfig,
  FilterBarConfig,
  FilterBarField,
  FilterGroup,
  FilterLeaf,
  JoinDef,
  PermissionDef,
  PerspectiveBase,
  PerspectiveSqlBase,
  PerspectiveTableBase,
  RelationDef,
  SortDef,
} from "@perspectives/dsl";
