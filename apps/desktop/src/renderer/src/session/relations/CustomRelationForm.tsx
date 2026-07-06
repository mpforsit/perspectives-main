import { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { RelationDef, SchemaSnapshot } from "@perspectives/engine";

import {
  findTableInSnapshot,
  validateCustomRelationDraft,
  type CustomRelationDraft,
  type ValidationIssue,
} from "./validate";

export interface CustomRelationFormProps {
  open: boolean;
  /** When set, the form opens in edit mode pre-filled with this relation's
   *  shape. The id is preserved on save. */
  editing: RelationDef | null;
  snapshot: SchemaSnapshot | undefined;
  existingRelations: readonly RelationDef[];
  onClose: () => void;
  /** Submit — either creates a new relation or updates `editing.id`. */
  onSubmit: (draft: CustomRelationDraft, editingId: string | null) => Promise<void>;
  /** Server-side rejection message — shown above the footer. */
  submitError: string | null;
  /** Whether a save is in flight. */
  submitting: boolean;
}

function emptyDraft(): CustomRelationDraft {
  return {
    fromSchema: "",
    fromTable: "",
    fromColumns: [],
    toSchema: "",
    toTable: "",
    toColumns: [],
    cardinality: "one-to-many",
    labelForward: "",
    labelReverse: "",
    displayDirection: "both",
  };
}

function draftFromRelation(r: RelationDef): CustomRelationDraft {
  return {
    fromSchema: r.from.schema,
    fromTable: r.from.table,
    fromColumns: [...r.from.columns],
    toSchema: r.to.schema,
    toTable: r.to.table,
    toColumns: [...r.to.columns],
    cardinality:
      r.cardinality === "many-to-many" ? "one-to-many" : r.cardinality,
    labelForward: r.label?.forward ?? "",
    labelReverse: r.label?.reverse ?? "",
    displayDirection: r.displayDirection,
  };
}

/**
 * Create / edit dialog for a custom RelationDef. Self-contained — does no
 * fetching of its own; the caller hands in the snapshot, the existing
 * relations (for duplicate detection), and the submit callback.
 */
export function CustomRelationForm({
  open,
  editing,
  snapshot,
  existingRelations,
  onClose,
  onSubmit,
  submitError,
  submitting,
}: CustomRelationFormProps) {
  const [draft, setDraft] = useState<CustomRelationDraft>(emptyDraft);

  // Reset / preload whenever the dialog opens or the target relation changes.
  useEffect(() => {
    if (!open) return;
    setDraft(editing === null ? emptyDraft() : draftFromRelation(editing));
  }, [open, editing]);

  const issues = useMemo(
    () => validateCustomRelationDraft(draft, snapshot, existingRelations),
    [draft, snapshot, existingRelations],
  );
  const valid = issues.length === 0;

  const schemas = useMemo(
    () => snapshot?.schemas.map((s) => s.name) ?? [],
    [snapshot],
  );

  const targetTable = useMemo(
    () =>
      snapshot === undefined
        ? undefined
        : findTableInSnapshot(snapshot, draft.toSchema, draft.toTable),
    [snapshot, draft.toSchema, draft.toTable],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="w-[min(96vw,820px)] max-w-none gap-4 p-0">
        <DialogHeader className="border-b px-5 pb-3 pt-4 text-left">
          <DialogTitle>
            {editing === null ? "New custom relation" : "Edit custom relation"}
          </DialogTitle>
          <DialogDescription>
            Connect two tables that have no foreign key between them.
            Treated identically to schema-derived relations in navigation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 px-5 py-2 md:grid-cols-2">
          <SidePicker
            title="Source"
            schemas={schemas}
            snapshot={snapshot}
            schemaValue={draft.fromSchema}
            tableValue={draft.fromTable}
            columnsValue={draft.fromColumns}
            onSchemaChange={(s) =>
              setDraft((d) => ({ ...d, fromSchema: s, fromTable: "", fromColumns: [] }))
            }
            onTableChange={(t) =>
              setDraft((d) => ({ ...d, fromTable: t, fromColumns: [] }))
            }
            onColumnsChange={(cols) => setDraft((d) => ({ ...d, fromColumns: cols }))}
          />
          <SidePicker
            title="Target"
            schemas={schemas}
            snapshot={snapshot}
            schemaValue={draft.toSchema}
            tableValue={draft.toTable}
            columnsValue={draft.toColumns}
            onSchemaChange={(s) =>
              setDraft((d) => ({ ...d, toSchema: s, toTable: "", toColumns: [] }))
            }
            onTableChange={(t) =>
              setDraft((d) => ({ ...d, toTable: t, toColumns: [] }))
            }
            onColumnsChange={(cols) => setDraft((d) => ({ ...d, toColumns: cols }))}
            hint={
              targetTable === undefined
                ? undefined
                : "Target columns must be a primary key or unique constraint."
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-4 border-t px-5 py-3 md:grid-cols-2">
          <fieldset>
            <legend className="text-xs font-medium text-foreground">
              Cardinality
            </legend>
            <div className="mt-1.5 flex flex-col gap-1">
              <RadioOption
                name="cardinality"
                value="one-to-many"
                label="One-to-many — multiple sources point to one target (the default)"
                checked={draft.cardinality === "one-to-many"}
                onChange={() =>
                  setDraft((d) => ({ ...d, cardinality: "one-to-many" }))
                }
              />
              <RadioOption
                name="cardinality"
                value="one-to-one"
                label="One-to-one — source columns are also unique"
                checked={draft.cardinality === "one-to-one"}
                onChange={() =>
                  setDraft((d) => ({ ...d, cardinality: "one-to-one" }))
                }
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Many-to-many with a custom junction lands in a later phase.
            </p>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-medium text-foreground">
              Display direction
            </legend>
            <div className="mt-1.5 flex flex-col gap-1">
              {(["both", "forward", "reverse"] as const).map((dir) => (
                <RadioOption
                  key={dir}
                  name="displayDirection"
                  value={dir}
                  label={
                    dir === "both"
                      ? "Both — show forward + reverse"
                      : dir === "forward"
                        ? "Forward only — hide the reverse-side entry"
                        : "Reverse only — hide the forward-side arrow"
                  }
                  checked={draft.displayDirection === dir}
                  onChange={() =>
                    setDraft((d) => ({ ...d, displayDirection: dir }))
                  }
                />
              ))}
            </div>
          </fieldset>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t px-5 py-3 md:grid-cols-2">
          <div>
            <Label htmlFor="relation-label-forward" className="text-xs">
              Forward label (optional)
            </Label>
            <Input
              id="relation-label-forward"
              value={draft.labelForward}
              onChange={(e) =>
                setDraft((d) => ({ ...d, labelForward: e.target.value }))
              }
              placeholder="e.g. country"
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label htmlFor="relation-label-reverse" className="text-xs">
              Reverse label (optional)
            </Label>
            <Input
              id="relation-label-reverse"
              value={draft.labelReverse}
              onChange={(e) =>
                setDraft((d) => ({ ...d, labelReverse: e.target.value }))
              }
              placeholder="e.g. orders shipped here"
              className="h-8 text-xs"
            />
          </div>
        </div>

        {(issues.length > 0 || submitError !== null) && (
          <div className="border-t px-5 py-3">
            {submitError !== null && (
              <Alert variant="destructive" className="mb-2 py-2 text-xs">
                <AlertCircle className="h-3.5 w-3.5" />
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}
            {issues.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {issues.map((issue, i) => (
                  <li key={i} className="flex items-baseline gap-1.5">
                    <span className="text-amber-600 dark:text-amber-400">•</span>
                    <span>{describeIssue(issue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="border-t px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid || submitting}
            onClick={() => {
              if (!valid) return;
              void onSubmit(draft, editing?.id ?? null);
            }}
          >
            {submitting
              ? "Saving…"
              : editing === null
                ? "Create relation"
                : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SidePickerProps {
  title: string;
  schemas: readonly string[];
  snapshot: SchemaSnapshot | undefined;
  schemaValue: string;
  tableValue: string;
  columnsValue: readonly string[];
  onSchemaChange: (next: string) => void;
  onTableChange: (next: string) => void;
  onColumnsChange: (next: string[]) => void;
  hint?: string | undefined;
}

function SidePicker({
  title,
  schemas,
  snapshot,
  schemaValue,
  tableValue,
  columnsValue,
  onSchemaChange,
  onTableChange,
  onColumnsChange,
  hint,
}: SidePickerProps) {
  const tablesForSchema = useMemo(() => {
    if (snapshot === undefined || schemaValue === "") return [];
    return (
      snapshot.schemas
        .find((s) => s.name === schemaValue)
        ?.tables.map((t) => t.name) ?? []
    );
  }, [snapshot, schemaValue]);

  const columnsForTable = useMemo(() => {
    if (snapshot === undefined || schemaValue === "" || tableValue === "") {
      return [];
    }
    return (
      findTableInSnapshot(snapshot, schemaValue, tableValue)?.columns.map(
        (c) => c.name,
      ) ?? []
    );
  }, [snapshot, schemaValue, tableValue]);

  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-[11px] text-muted-foreground">
          {columnsValue.length === 0
            ? "no columns selected"
            : `${columnsValue.length} column${columnsValue.length === 1 ? "" : "s"}`}
        </span>
      </header>

      <div className="space-y-2">
        <div>
          <Label className="text-[11px]">Schema</Label>
          <Select value={schemaValue} onValueChange={onSchemaChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Pick a schema" />
            </SelectTrigger>
            <SelectContent>
              {schemas.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-[11px]">Table</Label>
          <Select
            value={tableValue}
            onValueChange={onTableChange}
            disabled={schemaValue === ""}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={schemaValue === "" ? "Pick a schema first" : "Pick a table"} />
            </SelectTrigger>
            <SelectContent>
              {tablesForSchema.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <Label className="text-[11px]">Columns</Label>
            <span className="text-[10px] text-muted-foreground">
              click in pairing order
            </span>
          </div>
          <div
            className={cn(
              "mt-1 max-h-40 overflow-y-auto rounded-md border bg-background p-1 text-xs",
              tableValue === "" && "opacity-50",
            )}
          >
            {columnsForTable.length === 0 ? (
              <p className="px-2 py-1.5 text-muted-foreground">
                {tableValue === "" ? "—" : "Table has no columns?"}
              </p>
            ) : (
              columnsForTable.map((col) => {
                const idx = columnsValue.indexOf(col);
                const checked = idx >= 0;
                return (
                  <label
                    key={col}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent",
                      checked && "bg-accent/50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (!columnsValue.includes(col)) {
                            onColumnsChange([...columnsValue, col]);
                          }
                        } else {
                          onColumnsChange(columnsValue.filter((c) => c !== col));
                        }
                      }}
                      className="h-3 w-3"
                    />
                    <span className="flex-1 font-mono">{col}</span>
                    {checked && (
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        #{idx + 1}
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>
          {hint !== undefined && (
            <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function RadioOption({
  name,
  value,
  label,
  checked,
  onChange,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-3.5 w-3.5"
      />
      <span>{label}</span>
    </label>
  );
}

function describeIssue(issue: ValidationIssue): string {
  switch (issue.kind) {
    case "no-source-table":
      return "Pick a source table.";
    case "no-target-table":
      return "Pick a target table.";
    case "no-source-columns":
      return "Pick at least one source column.";
    case "no-target-columns":
      return "Pick at least one target column.";
    case "source-table-missing":
      return `Source table ${issue.schema}.${issue.table} is not in the current schema snapshot.`;
    case "target-table-missing":
      return `Target table ${issue.schema}.${issue.table} is not in the current schema snapshot.`;
    case "column-count-mismatch":
      return `Column count mismatch: ${issue.sourceCount} source vs ${issue.targetCount} target. Compound relations pair columns by position.`;
    case "target-not-unique":
      return `Target columns [${issue.columns.join(", ")}] are not a primary key or unique constraint. Pick columns that uniquely identify a row.`;
    case "source-not-unique-for-1to1":
      return `One-to-one requires the source columns [${issue.columns.join(", ")}] to be unique too. Switch to one-to-many, or pick a unique column set on the source.`;
    case "duplicate-of-schema-derived":
      return `A schema-derived relation with the same source / target / columns already exists.`;
  }
}
