import { useState, type FormEvent } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { trpc } from "../trpc/client";

import {
  SSL_MODES,
  defaultConnectionFormValues,
  validateConnectionForm,
  type ConnectionFormErrors,
  type ConnectionFormValues,
  type SslMode,
} from "./validate";
import type { ConnectionProfile, ConnectionProfileSummary } from "./types";

interface ConnectionFormProps {
  open: boolean;
  /** When set, the form opens in edit mode pre-populated from this profile.
   *  The password field starts blank — the user must re-enter on every save
   *  (we deliberately never read the password back from the engine).
   *
   *  Typed as `T | undefined` rather than `?: T` because callers pass it
   *  conditionally (`dialog.kind === "edit" ? dialog.profile : undefined`)
   *  and `exactOptionalPropertyTypes` rejects assigning explicit `undefined`
   *  to a `?:` field. */
  profile: ConnectionProfileSummary | undefined;
  onClose: () => void;
}

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "success"; serverName: string; serverVersion: string; latencyMs: number }
  | { kind: "error"; message: string };

/**
 * The shadcn dialog wrapping the connection form. Mounts only when `open` is
 * true so we don't accidentally hold form state between sessions (which would
 * mean holding a password longer than the form submission requires).
 */
export function ConnectionForm({ open, profile, onClose }: ConnectionFormProps) {
  if (!open) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {profile === undefined ? "Add connection" : `Edit ${profile.name}`}
          </DialogTitle>
          <DialogDescription>
            Connection credentials stay on this device. Passwords are encrypted
            with your operating system&apos;s secure storage.
          </DialogDescription>
        </DialogHeader>

        <FormBody profile={profile} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function FormBody({
  profile,
  onClose,
}: {
  profile: ConnectionProfileSummary | undefined;
  onClose: () => void;
}) {
  const [values, setValues] = useState<ConnectionFormValues>(() =>
    profile === undefined ? defaultConnectionFormValues() : formValuesFromProfile(profile),
  );
  const [errors, setErrors] = useState<ConnectionFormErrors>({});
  const [testState, setTestState] = useState<TestState>({ kind: "idle" });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const testMutation = trpc.connections.test.useMutation();
  const createMutation = trpc.connections.create.useMutation();
  const updateMutation = trpc.connections.update.useMutation();

  const isEdit = profile !== undefined;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isTesting = testState.kind === "running";

  const setField = <K extends keyof ConnectionFormValues>(
    field: K,
    value: ConnectionFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field] !== undefined) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleTest = async () => {
    const validation = validateConnectionForm(values);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    setTestState({ kind: "running" });
    try {
      const profileToTest = formValuesToProfile(validation.data, profile);
      const info = await testMutation.mutateAsync(profileToTest);
      setTestState({
        kind: "success",
        serverName: info.serverName,
        serverVersion: info.serverVersion,
        latencyMs: info.latencyMs,
      });
    } catch (cause) {
      setTestState({ kind: "error", message: friendlyMessage(cause) });
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    const validation = validateConnectionForm(values);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    try {
      const built = formValuesToProfile(validation.data, profile);
      if (isEdit) {
        await updateMutation.mutateAsync(built);
      } else {
        await createMutation.mutateAsync(built);
      }
      // Refresh the list so the new / renamed connection appears immediately.
      await utils.connections.list.invalidate();
      // Clear local state — the password is now in the credential store,
      // not in React state.
      setValues(defaultConnectionFormValues());
      setTestState({ kind: "idle" });
      onClose();
    } catch (cause) {
      setSubmitError(friendlyMessage(cause));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormField id="name" label="Name" error={errors.name}>
        <Input
          id="name"
          autoFocus
          value={values.name}
          onChange={(e) => setField("name", e.target.value)}
        />
      </FormField>

      <div className="grid grid-cols-[1fr_120px] gap-3">
        <FormField id="host" label="Host" error={errors.host}>
          <Input
            id="host"
            value={values.host}
            onChange={(e) => setField("host", e.target.value)}
          />
        </FormField>
        <FormField id="port" label="Port" error={errors.port}>
          <Input
            id="port"
            type="number"
            inputMode="numeric"
            value={values.port}
            onChange={(e) => setField("port", Number.parseInt(e.target.value, 10) || 0)}
          />
        </FormField>
      </div>

      <FormField id="database" label="Database" error={errors.database}>
        <Input
          id="database"
          value={values.database}
          onChange={(e) => setField("database", e.target.value)}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField id="user" label="User" error={errors.user}>
          <Input
            id="user"
            value={values.user}
            onChange={(e) => setField("user", e.target.value)}
            autoComplete="username"
          />
        </FormField>
        <FormField
          id="password"
          label={isEdit ? "Password (re-enter to save)" : "Password"}
          error={errors.password}
        >
          <Input
            id="password"
            type="password"
            value={values.password}
            onChange={(e) => setField("password", e.target.value)}
            autoComplete="new-password"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField id="sslMode" label="SSL mode" error={errors.sslMode}>
          <Select
            value={values.sslMode}
            onValueChange={(v) => setField("sslMode", v as SslMode)}
          >
            <SelectTrigger id="sslMode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SSL_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          id="applicationName"
          label="Application name"
          error={errors.applicationName}
        >
          <Input
            id="applicationName"
            value={values.applicationName}
            onChange={(e) => setField("applicationName", e.target.value)}
          />
        </FormField>
      </div>

      <TestResult state={testState} />
      {submitError !== null && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Failed to save</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      <DialogFooter className="gap-2 sm:gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleTest}
          disabled={isTesting || isSaving}
        >
          {isTesting ? "Testing…" : "Test connection"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : isEdit ? "Save changes" : "Save connection"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FormField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error !== undefined && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function TestResult({ state }: { state: TestState }) {
  if (state.kind === "idle" || state.kind === "running") return null;
  if (state.kind === "success") {
    return (
      <Alert variant="success">
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>Connected to {state.serverName}</AlertTitle>
        <AlertDescription>
          Server version {state.serverVersion} · {Math.round(state.latencyMs)} ms
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <XCircle className="h-4 w-4" />
      <AlertTitle>Could not connect</AlertTitle>
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

// ============================================================================
// Form-to-profile conversion
// ============================================================================

function formValuesFromProfile(
  profile: ConnectionProfileSummary,
): ConnectionFormValues {
  return {
    name: profile.name,
    host: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.user,
    // The password is never echoed back from the engine — re-enter on every save.
    password: "",
    sslMode: profile.ssl?.mode ?? "prefer",
    applicationName: profile.applicationName ?? "Perspectives",
  };
}

function formValuesToProfile(
  values: ConnectionFormValues,
  existing: ConnectionProfileSummary | undefined,
): ConnectionProfile {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name: values.name,
    dialect: "postgres",
    host: values.host,
    port: values.port,
    database: values.database,
    user: values.user,
    password: values.password,
    applicationName: values.applicationName,
    environment: existing?.environment ?? "development",
    ssl: { mode: values.sslMode },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function friendlyMessage(cause: unknown): string {
  if (cause instanceof Error) {
    // Trim the noisy "TRPCClientError: …" prefix when present.
    return cause.message.replace(/^TRPCClientError:\s*/, "");
  }
  return "Unknown error";
}
