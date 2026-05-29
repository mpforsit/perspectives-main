import { describe, it, expect } from "vitest";

import {
  ConflictError,
  ConnectionError,
  EngineError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "../src";

import type {
  AppendStore,
  AuditEvent,
  ConnectionInfo,
  ConnectionProfile,
  CRUDStore,
  Cursor,
  DatabaseAdapter,
  DialectMetadata,
  KVStore,
  Membership,
  MetadataStore,
  MutationPlan,
  MutationResult,
  PageResult,
  QueryPlan,
  ResultSet,
  SchemaSnapshot,
  Share,
  Workspace,
} from "../src";

describe("@perspectives/engine — public surface", () => {
  it("exports error classes that inherit from EngineError and from Error", () => {
    const errors: EngineError[] = [
      new ConnectionError("x"),
      new PermissionDeniedError("x"),
      new ValidationError("x"),
      new NotFoundError("x"),
      new ConflictError("x"),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(EngineError);
      expect(err).toBeInstanceOf(Error);
      expect(typeof err.code).toBe("string");
      expect(err.message).toBe("x");
    }
  });

  it("stamps each error subclass with its own code and name", () => {
    expect(new ConnectionError("x").code).toBe("CONNECTION_ERROR");
    expect(new PermissionDeniedError("x").code).toBe("PERMISSION_DENIED");
    expect(new ValidationError("x").code).toBe("VALIDATION_ERROR");
    expect(new NotFoundError("x").code).toBe("NOT_FOUND");
    expect(new ConflictError("x").code).toBe("CONFLICT");

    expect(new ConnectionError("x").name).toBe("ConnectionError");
    expect(new PermissionDeniedError("x").name).toBe("PermissionDeniedError");
    expect(new ValidationError("x").name).toBe("ValidationError");
    expect(new NotFoundError("x").name).toBe("NotFoundError");
    expect(new ConflictError("x").name).toBe("ConflictError");
  });

  it("carries optimistic-locking context on ConflictError", () => {
    const err = new ConflictError("row changed underneath", {
      expected: { id: 1, version: 7 },
      actual: { id: 1, version: 8 },
    });
    expect(err.expected).toEqual({ id: 1, version: 7 });
    expect(err.actual).toEqual({ id: 1, version: 8 });
  });

  it("propagates ErrorOptions.cause through the EngineError base", () => {
    const root = new Error("boom");
    const err = new ConnectionError("cannot reach db", { cause: root });
    expect(err.cause).toBe(root);
  });

  it("exposes the type-only surface (compile-check)", () => {
    // This function only exists to anchor every type import so the typechecker
    // verifies that each symbol is exported with the expected shape. The body
    // is never called — its return type and parameters are the actual assertion.
    function surface(args: {
      adapter: DatabaseAdapter;
      store: MetadataStore;
      crud: CRUDStore<{ id: string }>;
      append: AppendStore<{ id: string }>;
      kv: KVStore;
      audit: AuditEvent;
      snapshot: SchemaSnapshot;
      query: QueryPlan;
      mutation: MutationPlan;
      results: ResultSet;
      mutationResult: MutationResult;
      cursor: Cursor;
      page: PageResult;
      info: ConnectionInfo;
      dialect: DialectMetadata;
      profile: ConnectionProfile;
      workspace: Workspace;
      member: Membership;
      share: Share;
    }): typeof args {
      return args;
    }
    expect(typeof surface).toBe("function");
  });
});
