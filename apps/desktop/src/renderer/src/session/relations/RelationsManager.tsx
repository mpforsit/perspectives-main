import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { RelationDef } from "@perspectives/engine";

import { trpc } from "../../trpc/client";

import { CustomRelationForm } from "./CustomRelationForm";
import type { CustomRelationDraft } from "./validate";

export interface RelationsManagerProps {
  open: boolean;
  connectionId: string;
  onClose: () => void;
}

/**
 * The "Manage relations" dialog opened from the SessionView topbar. Lists
 * every relation for the active connection — schema-derived ones with a
 * "schema" pill (read-only), custom ones with edit + delete buttons.
 * Hosts a child dialog (`CustomRelationForm`) for create/edit.
 */
export function RelationsManager({
  open,
  connectionId,
  onClose,
}: RelationsManagerProps) {
  const utils = trpc.useUtils();
  const relationsQuery = trpc.relations.list.useQuery(
    { connectionId },
    { enabled: open },
  );
  const schemaQuery = trpc.schema.get.useQuery(
    { connectionId },
    { enabled: open },
  );

  const [filter, setFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RelationDef | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const rels = relationsQuery.data ?? [];
    const q = filter.trim().toLowerCase();
    if (q === "") return rels;
    return rels.filter((r) => {
      const summary = relationSummary(r).toLowerCase();
      return summary.includes(q);
    });
  }, [relationsQuery.data, filter]);

  const handleSubmit = async (draft: CustomRelationDraft, editingId: string | null) => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const payload = {
        from: {
          schema: draft.fromSchema,
          table: draft.fromTable,
          columns: [...draft.fromColumns],
        },
        to: {
          schema: draft.toSchema,
          table: draft.toTable,
          columns: [...draft.toColumns],
        },
        cardinality: draft.cardinality,
        label:
          draft.labelForward !== "" || draft.labelReverse !== ""
            ? {
                ...(draft.labelForward !== "" ? { forward: draft.labelForward } : {}),
                ...(draft.labelReverse !== "" ? { reverse: draft.labelReverse } : {}),
              }
            : undefined,
        displayDirection: draft.displayDirection,
      };
      if (editingId === null) {
        await utils.client.relations.createCustom.mutate({
          connectionId,
          relation: payload,
        });
      } else {
        await utils.client.relations.updateCustom.mutate({
          connectionId,
          id: editingId,
          relation: payload,
        });
      }
      await utils.relations.list.invalidate({ connectionId });
      setFormOpen(false);
      setEditing(null);
    } catch (cause: unknown) {
      const message =
        cause instanceof Error
          ? cause.message.replace(/^TRPCClientError:\s*/, "")
          : "Unknown error";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (relation: RelationDef) => {
    if (relation.source !== "custom") return;
    const summary = relationSummary(relation);
    const ok = window.confirm(
      `Delete custom relation "${summary}"? This can't be undone (re-create from scratch if needed).`,
    );
    if (!ok) return;
    try {
      await utils.client.relations.deleteCustom.mutate({
        connectionId,
        id: relation.id,
      });
      await utils.relations.list.invalidate({ connectionId });
    } catch (cause: unknown) {
      const message =
        cause instanceof Error ? cause.message : "Unknown error";
      window.alert(`Could not delete: ${message}`);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
        <DialogContent className="flex h-[80vh] w-[min(96vw,900px)] max-w-none flex-col gap-0 p-0">
          <DialogHeader className="border-b px-5 pb-3 pt-4 text-left">
            <DialogTitle>Manage relations</DialogTitle>
            <DialogDescription>
              Schema-derived relations come from the database&apos;s foreign keys.
              Custom relations live in Perspectives metadata and are scoped to
              this database.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 border-b px-5 py-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by table or column…"
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              className="h-8 shrink-0 gap-1.5 px-2.5"
              onClick={() => {
                setEditing(null);
                setSubmitError(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              New relation
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-3">
            {relationsQuery.isPending || schemaQuery.isPending ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : relationsQuery.isError ? (
              <p className="text-xs text-destructive">
                Couldn&apos;t load relations — {relationsQuery.error.message}
              </p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {filter.trim() === ""
                  ? "No relations yet for this connection."
                  : `No relations match "${filter.trim()}".`}
              </p>
            ) : (
              <ul className="space-y-1">
                {filtered.map((r) => (
                  <RelationRow
                    key={r.id}
                    relation={r}
                    onEdit={() => {
                      setEditing(r);
                      setSubmitError(null);
                      setFormOpen(true);
                    }}
                    onDelete={() => void handleDelete(r)}
                  />
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <CustomRelationForm
        open={formOpen}
        editing={editing}
        snapshot={schemaQuery.data}
        existingRelations={relationsQuery.data ?? []}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
          setSubmitError(null);
        }}
        onSubmit={handleSubmit}
        submitError={submitError}
        submitting={submitting}
      />
    </>
  );
}

function RelationRow({
  relation,
  onEdit,
  onDelete,
}: {
  relation: RelationDef;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isCustom = relation.source === "custom";
  return (
    <li className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
              isCustom
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {relation.source}
          </span>
          <span className="rounded-sm bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {relation.cardinality}
          </span>
          {relation.label?.forward !== undefined && (
            <span className="text-[11px] italic text-muted-foreground">
              “{relation.label.forward}”
            </span>
          )}
        </div>
        <div className="mt-1 font-mono text-xs">
          <span className="text-muted-foreground">{relation.from.schema}.</span>
          <span>{relation.from.table}</span>
          <span className="text-muted-foreground">
            {" "}
            ({relation.from.columns.join(", ")})
          </span>
          <span className="px-2 text-muted-foreground">→</span>
          <span className="text-muted-foreground">{relation.to.schema}.</span>
          <span>{relation.to.table}</span>
          <span className="text-muted-foreground">
            {" "}
            ({relation.to.columns.join(", ")})
          </span>
        </div>
      </div>
      {isCustom && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onEdit}
            aria-label="Edit custom relation"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onDelete}
            aria-label="Delete custom relation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </li>
  );
}

function relationSummary(r: RelationDef): string {
  return `${r.from.schema}.${r.from.table}(${r.from.columns.join(",")}) → ${r.to.schema}.${r.to.table}(${r.to.columns.join(",")})`;
}
