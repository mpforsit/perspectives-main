import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Trash2 } from "lucide-react";

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

import type {
  ColumnInfo,
  DisplayConfig,
  RelationDef,
} from "@perspectives/engine";

import { trpc } from "../trpc/client";

/**
 * Pulled into the renderer (instead of imported from `@perspectives/engine`)
 * to keep the renderer's runtime-import graph clean — the engine package
 * has `node:crypto` in its module tree and pulling any runtime value
 * across the boundary drags those imports into the browser bundle. Keep
 * in sync with `extractTemplateColumns` in
 * `packages/engine/src/display.ts`.
 */
function extractTemplateColumns(template: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pattern = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    const col = match[1];
    if (col === undefined) continue;
    if (seen.has(col)) continue;
    seen.add(col);
    out.push(col);
  }
  return out;
}

const NONE_VALUE = "__none__";

export interface TableSettingsDialogProps {
  open: boolean;
  connectionId: string;
  schema: string;
  table: string;
  /** Columns of the focused table, from the schema snapshot. */
  columns: readonly ColumnInfo[];
  /** Primary key of the focused table; drives which outbound relations are
   *  eligible for cardinality preview (the relation's target-side columns
   *  must equal this PK in PK order, so PK-keyed lookups can resolve). */
  primaryKey: readonly string[];
  /** Full relations list for the current connection. The dialog filters
   *  this to outbound relations from the focused table for the preview
   *  picker. */
  relations: readonly RelationDef[];
  onClose: () => void;
}

/**
 * Per-table settings popover with a Display tab. Currently the only tab —
 * Phase 2.3's junction policy lands here as a second tab later. The
 * Display tab persists a `DisplayConfig` row scoped to the connection's
 * database; consumers (FK cells, breadcrumbs, inspector) pick it up via
 * `displayConfig.getForTable` + `data.getRowLabels`.
 */
export function TableSettingsDialog({
  open,
  connectionId,
  schema,
  table,
  columns,
  primaryKey,
  relations,
  onClose,
}: TableSettingsDialogProps) {
  const utils = trpc.useUtils();
  const configQuery = trpc.displayConfig.getForTable.useQuery(
    { connectionId, schema, table },
    { enabled: open },
  );

  const [displayColumn, setDisplayColumn] = useState<string>("");
  const [secondaryColumn, setSecondaryColumn] = useState<string>(NONE_VALUE);
  const [template, setTemplate] = useState<string>("");
  const [cardinalityRelations, setCardinalityRelations] = useState<string[]>(
    [],
  );
  const [saving, setSaving] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load existing config into the form when the dialog opens (or the
  // active table changes underneath us).
  useEffect(() => {
    if (!open) return;
    const cfg = configQuery.data ?? null;
    setDisplayColumn(cfg?.displayColumn ?? "");
    setSecondaryColumn(cfg?.secondaryColumn ?? NONE_VALUE);
    setTemplate(cfg?.rowLabelTemplate ?? "");
    setCardinalityRelations(cfg?.cardinalityRelations ?? []);
    setSubmitError(null);
  }, [open, configQuery.data]);

  // Outbound relations eligible for cardinality preview. Eligibility mirrors
  // what `engine.getCountsForRows` accepts:
  //   - 1:n / 1:1 where source is the parent (`to`) side AND `to.columns`
  //     equals the source PK in PK order.
  //   - m:n where either side matches source AND that side's columns equal
  //     the source PK in PK order.
  // Anything else is silently filtered out — the user can't pick it.
  const previewCandidates = useMemo(() => {
    const pkMatch = (cols: readonly string[]) =>
      cols.length === primaryKey.length &&
      cols.every((c, i) => c === primaryKey[i]);

    const out: Array<{ id: string; label: string; targetLabel: string }> = [];
    for (const rel of relations) {
      if (rel.cardinality === "many-to-many") {
        if (rel.junction === undefined) continue;
        if (
          rel.from.schema === schema &&
          rel.from.table === table &&
          pkMatch(rel.from.columns)
        ) {
          out.push({
            id: rel.id,
            label: rel.label?.forward ?? rel.to.table,
            targetLabel: `via ${rel.junction.table} → ${rel.to.table}`,
          });
        } else if (
          rel.to.schema === schema &&
          rel.to.table === table &&
          pkMatch(rel.to.columns)
        ) {
          out.push({
            id: rel.id,
            label: rel.label?.reverse ?? rel.from.table,
            targetLabel: `via ${rel.junction.table} → ${rel.from.table}`,
          });
        }
        continue;
      }
      // 1:n / 1:1 — source on the parent (`to`) side, viewing children.
      if (rel.to.schema !== schema || rel.to.table !== table) continue;
      if (!pkMatch(rel.to.columns)) continue;
      out.push({
        id: rel.id,
        label: rel.label?.reverse ?? rel.from.table,
        targetLabel: `${rel.from.schema}.${rel.from.table}`,
      });
    }
    return out;
  }, [relations, schema, table, primaryKey]);

  const togglePreviewRelation = (id: string) => {
    setCardinalityRelations((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev; // hard cap; checkbox renders disabled
      return [...prev, id];
    });
  };

  const columnNames = useMemo(() => columns.map((c) => c.name), [columns]);
  const validColumnSet = useMemo(() => new Set(columnNames), [columnNames]);

  const templateColumns = useMemo(
    () => extractTemplateColumns(template),
    [template],
  );
  const templateUnknownColumns = templateColumns.filter(
    (c) => !validColumnSet.has(c),
  );

  // Save is gated only on "not currently saving" — every field is optional
  // now (displayColumn moved to optional so a cardinality-only config is
  // valid). The Clear button still fully removes the row.
  const canSave = saving === false;
  const isDirty = configQuery.data !== undefined;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const next: DisplayConfig = {
        schema,
        table,
        ...(displayColumn !== "" ? { displayColumn } : {}),
        ...(secondaryColumn !== NONE_VALUE
          ? { secondaryColumn }
          : {}),
        ...(template.trim().length > 0 ? { rowLabelTemplate: template } : {}),
        ...(cardinalityRelations.length > 0
          ? { cardinalityRelations }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      await utils.client.displayConfig.upsert.mutate({
        connectionId,
        displayConfig: next,
      });
      await utils.displayConfig.getForTable.invalidate({
        connectionId,
        schema,
        table,
      });
      onClose();
    } catch (cause: unknown) {
      const message =
        cause instanceof Error
          ? cause.message.replace(/^TRPCClientError:\s*/, "")
          : "Unknown error";
      setSubmitError(message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (configQuery.data === null || configQuery.data === undefined) return;
    setSaving(true);
    setSubmitError(null);
    try {
      await utils.client.displayConfig.delete.mutate({
        connectionId,
        schema,
        table,
      });
      await utils.displayConfig.getForTable.invalidate({
        connectionId,
        schema,
        table,
      });
      setDisplayColumn("");
      setSecondaryColumn(NONE_VALUE);
      setTemplate("");
      setCardinalityRelations([]);
      onClose();
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : "Unknown error";
      setSubmitError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="w-[min(96vw,600px)] max-w-none gap-0 p-0">
        <DialogHeader className="border-b px-5 pb-3 pt-4 text-left">
          <DialogTitle>
            Table settings — {schema}.{table}
          </DialogTitle>
          <DialogDescription>
            How rows of this table appear in FK cells, breadcrumbs, and the
            row inspector.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-4 px-5 py-4">
          <div>
            <Label className="text-xs">Display column</Label>
            <Select value={displayColumn} onValueChange={setDisplayColumn}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Pick a column" />
              </SelectTrigger>
              <SelectContent>
                {columnNames.map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The primary label shown for each row when this table is
              referenced. Default: PK values joined by ·.
            </p>
          </div>

          <div>
            <Label className="text-xs">Secondary column (optional)</Label>
            <Select
              value={secondaryColumn}
              onValueChange={setSecondaryColumn}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE} className="text-xs">
                  None
                </SelectItem>
                {columnNames.map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Shown as a smaller subtitle alongside the display column. Not
              currently rendered in the FK cell; used by the inspector and
              breadcrumbs.
            </p>
          </div>

          <div>
            <Label htmlFor="row-label-template" className="text-xs">
              Row label template (optional)
            </Label>
            <Input
              id="row-label-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="{first_name} {last_name}"
              className="h-8 text-xs font-mono"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Overrides the display column when set. Use{" "}
              <code className="rounded bg-muted px-1">{"{column_name}"}</code>{" "}
              placeholders. Missing or null values render as empty.
            </p>
            {templateColumns.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Template references:{" "}
                {templateColumns.map((c, i) => (
                  <span key={c}>
                    {i > 0 ? ", " : ""}
                    <code
                      className={
                        validColumnSet.has(c)
                          ? "rounded bg-muted px-1"
                          : "rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300"
                      }
                    >
                      {c}
                    </code>
                  </span>
                ))}
              </p>
            )}
            {templateUnknownColumns.length > 0 && (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                Unknown column
                {templateUnknownColumns.length === 1 ? "" : "s"}:{" "}
                {templateUnknownColumns.join(", ")} — will render as empty.
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs">Preview cardinality (optional)</Label>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Show a count badge in the row gutter for up to two outbound
              relations (e.g. "47 orders"). Above ~100k target rows the badge
              renders an estimate (~).
            </p>
            {previewCandidates.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">
                No eligible outbound relations — this table needs a primary
                key and at least one relation whose target columns match it.
              </p>
            ) : (
              <ul className="space-y-1">
                {previewCandidates.map((cand) => {
                  const checked = cardinalityRelations.includes(cand.id);
                  const disabled =
                    !checked && cardinalityRelations.length >= 2;
                  return (
                    <li key={cand.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                          checked
                            ? "border-foreground/30 bg-muted"
                            : "border-transparent hover:bg-muted/50"
                        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => togglePreviewRelation(cand.id)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="flex-1">
                          <span className="font-medium">{cand.label}</span>
                          <span className="ml-2 text-[11px] text-muted-foreground">
                            {cand.targetLabel}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {submitError !== null && (
          <div className="border-t px-5 py-3">
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertCircle className="h-3.5 w-3.5" />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter className="flex items-center justify-between border-t px-5 py-3 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => void clear()}
            disabled={
              saving ||
              configQuery.data === null ||
              configQuery.data === undefined
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear settings
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={!canSave}>
              {saving ? "Saving…" : isDirty ? "Save changes" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
