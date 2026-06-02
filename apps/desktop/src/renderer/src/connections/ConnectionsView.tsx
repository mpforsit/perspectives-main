import { useState } from "react";

import { trpc } from "../trpc/client";

import { ConnectionForm } from "./ConnectionForm";
import { ConnectionList } from "./ConnectionList";
import { EmptyState } from "./EmptyState";
import type { ConnectionProfileSummary } from "./types";

type DialogState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; profile: ConnectionProfileSummary };

interface ConnectionsViewProps {
  connections: ConnectionProfileSummary[];
  onOpen: (profile: ConnectionProfileSummary) => void;
}

/**
 * The connection-manager view. Owns the dialog state and dispatches between
 * the empty-state CTA and the saved-connection list. Clicking a saved
 * connection routes upward via `onOpen`; the parent App then mounts the
 * session view, which is where the engine's `connect` actually fires.
 */
export function ConnectionsView({ connections, onOpen }: ConnectionsViewProps) {
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });

  const utils = trpc.useUtils();
  const deleteMutation = trpc.connections.delete.useMutation({
    onSuccess: () => utils.connections.list.invalidate(),
  });

  const handleDelete = (profile: ConnectionProfileSummary) => {
    const ok = window.confirm(
      `Delete connection "${profile.name}"? This removes the stored credential.`,
    );
    if (!ok) return;
    void deleteMutation.mutateAsync({ connectionId: profile.id });
  };

  return (
    <>
      {connections.length === 0 ? (
        <EmptyState onAdd={() => setDialog({ kind: "create" })} />
      ) : (
        <ConnectionList
          connections={connections}
          onAdd={() => setDialog({ kind: "create" })}
          onOpen={onOpen}
          onEdit={(profile) => setDialog({ kind: "edit", profile })}
          onDelete={handleDelete}
        />
      )}

      <ConnectionForm
        open={dialog.kind !== "closed"}
        profile={dialog.kind === "edit" ? dialog.profile : undefined}
        onClose={() => setDialog({ kind: "closed" })}
      />
    </>
  );
}
