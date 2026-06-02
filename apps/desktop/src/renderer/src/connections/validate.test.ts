import { describe, expect, it } from "vitest";

import {
  defaultConnectionFormValues,
  validateConnectionForm,
  type ConnectionFormValues,
} from "./validate";

const valid: ConnectionFormValues = {
  name: "Local Postgres",
  host: "localhost",
  port: 5432,
  database: "perspectives_dev",
  user: "perspectives",
  password: "secret",
  sslMode: "prefer",
  applicationName: "Perspectives",
};

describe("validateConnectionForm", () => {
  it("accepts a fully-populated valid form", () => {
    const result = validateConnectionForm(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(valid);
  });

  it("trims surrounding whitespace from string fields", () => {
    const result = validateConnectionForm({
      ...valid,
      name: "  My DB  ",
      host: " localhost ",
      database: "  perspectives_dev",
      user: "perspectives ",
      applicationName: "  Perspectives  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("My DB");
      expect(result.data.host).toBe("localhost");
      expect(result.data.database).toBe("perspectives_dev");
      expect(result.data.user).toBe("perspectives");
      expect(result.data.applicationName).toBe("Perspectives");
    }
  });

  it("does NOT trim the password — leading/trailing whitespace can be intentional", () => {
    const result = validateConnectionForm({ ...valid, password: " spaced " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.password).toBe(" spaced ");
  });

  it("rejects an empty name with a field-specific error message", () => {
    const result = validateConnectionForm({ ...valid, name: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toBeDefined();
      expect(result.errors.name).toMatch(/required/i);
    }
  });

  it("rejects a port below 1 or above 65535", () => {
    const low = validateConnectionForm({ ...valid, port: 0 });
    const high = validateConnectionForm({ ...valid, port: 70_000 });
    expect(low.ok).toBe(false);
    expect(high.ok).toBe(false);
    if (!low.ok) expect(low.errors.port).toMatch(/65535/);
    if (!high.ok) expect(high.errors.port).toMatch(/65535/);
  });

  it("rejects a non-integer port", () => {
    const result = validateConnectionForm({ ...valid, port: 5432.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.port).toBeDefined();
  });

  it("rejects a missing password", () => {
    const result = validateConnectionForm({ ...valid, password: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.password).toMatch(/required/i);
  });

  it("rejects an unknown SSL mode", () => {
    const result = validateConnectionForm({ ...valid, sslMode: "bogus" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.sslMode).toBeDefined();
  });

  it("collects errors for every invalid field at once", () => {
    const result = validateConnectionForm({
      name: "",
      host: "",
      port: -1,
      database: "",
      user: "",
      password: "",
      sslMode: "prefer",
      applicationName: "Perspectives",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toBeDefined();
      expect(result.errors.host).toBeDefined();
      expect(result.errors.port).toBeDefined();
      expect(result.errors.database).toBeDefined();
      expect(result.errors.user).toBeDefined();
      expect(result.errors.password).toBeDefined();
    }
  });
});

describe("defaultConnectionFormValues", () => {
  it("returns a fresh object each call (no shared mutation)", () => {
    const a = defaultConnectionFormValues();
    const b = defaultConnectionFormValues();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("defaults to port 5432, prefer SSL, and applicationName=Perspectives", () => {
    const d = defaultConnectionFormValues();
    expect(d.port).toBe(5432);
    expect(d.sslMode).toBe("prefer");
    expect(d.applicationName).toBe("Perspectives");
  });
});
