/**
 * Pure validation for the connection form. No React, no Electron, no DOM —
 * unit-testable in node.
 *
 * The form is intentionally flat (`sslMode` at the top level rather than
 * `ssl.mode` nested) because it maps 1:1 to inputs the user actually fills.
 * The submit step in `ConnectionForm.tsx` re-shapes it into the engine's
 * `ConnectionProfile` (nested `ssl: { mode }`) before calling tRPC.
 */

import { z } from "zod";

export const SSL_MODES = [
  "disable",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
] as const;

export type SslMode = (typeof SSL_MODES)[number];

export const connectionFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(128, "Name is too long"),
  host: z.string().trim().min(1, "Host is required").max(255, "Host is too long"),
  port: z
    .number({ invalid_type_error: "Port must be a number" })
    .int("Port must be a whole number")
    .min(1, "Port must be between 1 and 65535")
    .max(65_535, "Port must be between 1 and 65535"),
  database: z
    .string()
    .trim()
    .min(1, "Database is required")
    .max(255, "Database name is too long"),
  user: z.string().trim().min(1, "User is required").max(255, "User is too long"),
  password: z.string().min(1, "Password is required"),
  sslMode: z.enum(SSL_MODES, {
    errorMap: () => ({ message: "Select a valid SSL mode" }),
  }),
  applicationName: z
    .string()
    .trim()
    .min(1, "Application name is required")
    .max(64, "Application name is too long"),
});

export type ConnectionFormValues = z.infer<typeof connectionFormSchema>;
export type ConnectionFormErrors = Partial<
  Record<keyof ConnectionFormValues, string>
>;

export type ConnectionFormValidation =
  | { ok: true; data: ConnectionFormValues }
  | { ok: false; errors: ConnectionFormErrors };

/** The defaults the form opens with for a new connection. */
export function defaultConnectionFormValues(): ConnectionFormValues {
  return {
    name: "",
    host: "localhost",
    port: 5432,
    database: "",
    user: "",
    password: "",
    sslMode: "prefer",
    applicationName: "Perspectives",
  };
}

/**
 * Validate raw form values. Returns either the cleaned, typed values (with
 * surrounding whitespace trimmed) or a per-field error map for inline
 * display in the UI.
 */
export function validateConnectionForm(
  input: unknown,
): ConnectionFormValidation {
  const result = connectionFormSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const errors: ConnectionFormErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (
      typeof field === "string" &&
      isFormField(field) &&
      errors[field] === undefined
    ) {
      errors[field] = issue.message;
    }
  }
  return { ok: false, errors };
}

function isFormField(key: string): key is keyof ConnectionFormValues {
  return [
    "name",
    "host",
    "port",
    "database",
    "user",
    "password",
    "sslMode",
    "applicationName",
  ].includes(key);
}
