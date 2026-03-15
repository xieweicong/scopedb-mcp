import { describe, it, expect } from "vitest";
import { guardQuery, guardMutate, PermissionError } from "../permission-guard.js";
import type { ScopedConfig } from "../../config/types.js";

const readOnlyScope: ScopedConfig = {
  scopeName: "support",
  tables: {
    users: {
      name: "users",
      access: ["read"],
      columns: [
        { name: "name", type: "text" },
        { name: "department", type: "text" },
      ],
    },
    orders: {
      name: "orders",
      access: ["read"],
      columns: [
        { name: "product", type: "text" },
        { name: "amount", type: "integer" },
        { name: "status", type: "text" },
      ],
    },
  },
  relations: [],
  settings: {
    max_rows: 50,
    max_joins: 1,
    timeout_ms: 5000,
    result_format: "compact",
    allow_aggregate: false,
  },
};

const writeScope: ScopedConfig = {
  scopeName: "admin",
  tables: {
    orders: {
      name: "orders",
      access: ["read", "write"],
      columns: [
        { name: "product", type: "text" },
        { name: "status", type: "text" },
      ],
      writable_columns: ["status"],
    },
  },
  relations: [],
  settings: {
    max_rows: 1000,
    max_joins: 3,
    timeout_ms: 5000,
    result_format: "compact",
    allow_aggregate: true,
  },
};

describe("guardQuery", () => {
  it("should allow valid query", () => {
    expect(() =>
      guardQuery(readOnlyScope, {
        table: "users",
        select: ["name"],
      }),
    ).not.toThrow();
  });

  it("should reject unknown table", () => {
    expect(() =>
      guardQuery(readOnlyScope, { table: "secret" }),
    ).toThrow(PermissionError);
  });

  it("should reject hidden column in select", () => {
    expect(() =>
      guardQuery(readOnlyScope, {
        table: "users",
        select: ["salary"],
      }),
    ).toThrow("not visible");
  });

  it("should reject hidden column in where", () => {
    expect(() =>
      guardQuery(readOnlyScope, {
        table: "users",
        where: [{ column: "email", op: "eq", value: "x" }],
      }),
    ).toThrow("hidden column");
  });

  it("should reject invalid operator", () => {
    expect(() =>
      guardQuery(readOnlyScope, {
        table: "users",
        where: [{ column: "name", op: "DROP TABLE", value: "" }],
      }),
    ).toThrow("Invalid operator");
  });

  it("should reject too many joins", () => {
    expect(() =>
      guardQuery(readOnlyScope, {
        table: "users",
        join: ["orders", "products"],
      }),
    ).toThrow("Too many joins");
  });

  it("should count implicit joins from dotted selects against max_joins", () => {
    // readOnlyScope has max_joins=1
    expect(() =>
      guardQuery(readOnlyScope, {
        table: "users",
        select: ["name", "orders.product"],
      }),
    ).not.toThrow(); // 1 implicit join, max_joins=1 → ok

    expect(() =>
      guardQuery(readOnlyScope, {
        table: "users",
        select: ["orders.product"],
        join: ["orders"], // explicit + implicit = same table, should not double-count
      }),
    ).not.toThrow();
  });

  it("should reject implicit join on table without read access", () => {
    const scopeNoRead: ScopedConfig = {
      ...readOnlyScope,
      tables: {
        ...readOnlyScope.tables,
        secrets: {
          name: "secrets",
          access: ["write"], // no read
          columns: [{ name: "data", type: "text" }],
        },
      },
    };
    expect(() =>
      guardQuery(scopeNoRead, {
        table: "users",
        select: ["secrets.data"],
      }),
    ).toThrow("read access");
  });

  it("should reject aggregate when not allowed", () => {
    expect(() =>
      guardQuery(readOnlyScope, {
        table: "users",
        aggregate: { fn: "count" },
      }),
    ).toThrow("not allowed");
  });

  it("should allow aggregate when allowed", () => {
    expect(() =>
      guardQuery(writeScope, {
        table: "orders",
        aggregate: { fn: "count" },
      }),
    ).not.toThrow();
  });
});

describe("guardMutate", () => {
  it("should allow valid mutation", () => {
    expect(() =>
      guardMutate(writeScope, {
        table: "orders",
        action: "update",
        where: [{ column: "product", op: "eq", value: "test" }],
        data: { status: "shipped" },
      }),
    ).not.toThrow();
  });

  it("should reject mutation on read-only table", () => {
    expect(() =>
      guardMutate(readOnlyScope, {
        table: "users",
        action: "update",
        where: [{ column: "name", op: "eq", value: "x" }],
        data: { name: "y" },
      }),
    ).toThrow("write access");
  });

  it("should reject mutation on non-writable column", () => {
    expect(() =>
      guardMutate(writeScope, {
        table: "orders",
        action: "update",
        where: [{ column: "product", op: "eq", value: "x" }],
        data: { product: "hacked" },
      }),
    ).toThrow("not writable");
  });

  it("should reject mutation without WHERE", () => {
    expect(() =>
      guardMutate(writeScope, {
        table: "orders",
        action: "update",
        where: [],
        data: { status: "x" },
      }),
    ).toThrow("at least one WHERE");
  });
});
