export * from "./adapter";
export * from "./metadata";
export * from "./audit";
export * from "./errors";
export * from "./service";

// Re-export DSL types so adapter / store packages can pull everything they
// need from a single `@perspectives/engine` import. The DSL stays the source
// of truth; this is a convenience surface, not a parallel definition.
export type {
  ColumnDef,
  ColumnSource,
  FilterBarConfig,
  FilterBarField,
  FilterGroup,
  FilterLeaf,
  JoinDef,
  PermissionDef,
  PerspectiveBase,
  PerspectiveSqlBase,
  PerspectiveTableBase,
  SortDef,
} from "@perspectives/dsl";
