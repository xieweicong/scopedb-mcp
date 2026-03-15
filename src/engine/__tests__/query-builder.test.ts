import { describe, it, expect } from "vitest";
import { buildQuery, buildMutateWhere } from "../query-builder.js";
import type { ScopedConfig } from "../../config/types.js";

const scope: ScopedConfig = {
  scopeName: "test",
  tables: {
    users: {
      name: "users",
      access: ["read"],
      columns: [
        { name: "name", type: "text" },
        { name: "department", type: "text" },
      ],
      row_filter: "deleted_at IS NULL",
    },
    orders: {
      name: "orders",
      access: ["read", "write"],
      columns: [
        { name: "product", type: "text" },
        { name: "amount", type: "integer" },
        { name: "status", type: "text" },
      ],
      writable_columns: ["status"],
      row_filter: "user_id = 'abc-123'",
    },
  },
  relations: [],
  settings: {
    max_rows: 100,
    max_joins: 2,
    timeout_ms: 5000,
    result_format: "compact",
    allow_aggregate: true,
  },
};

describe("buildQuery", () => {
  it("should inject row_filter as structured conditions", () => {
    const params = buildQuery(scope, { table: "users" });
    // "deleted_at IS NULL" should become { column: "deleted_at", op: "is_null" }
    const filterCondition = params.where.find((w) => w.column === "deleted_at");
    expect(filterCondition).toBeDefined();
    expect(filterCondition!.op).toBe("is_null");
  });

  it("should parse equality row_filter", () => {
    const params = buildQuery(scope, { table: "orders" });
    const filterCondition = params.where.find((w) => w.column === "user_id");
    expect(filterCondition).toBeDefined();
    expect(filterCondition!.op).toBe("eq");
    expect(filterCondition!.value).toBe("abc-123");
  });

  it("should enforce max_rows limit", () => {
    const params = buildQuery(scope, { table: "users", limit: 999 });
    expect(params.limit).toBe(100); // capped to scope max_rows
  });
});

describe("buildQuery joins", () => {
  it("should inject joinFilters for joined tables with row_filter", () => {
    const params = buildQuery(scope, {
      table: "orders",
      join: ["users"],
    });
    // users has row_filter "deleted_at IS NULL"
    expect(params.joinFilters).toBeDefined();
    expect(params.joinFilters!.users).toBeDefined();
    expect(params.joinFilters!.users[0].column).toBe("deleted_at");
    expect(params.joinFilters!.users[0].op).toBe("is_null");
  });

  it("should not have joinFilters for tables without row_filter", () => {
    const noFilterScope: ScopedConfig = {
      ...scope,
      tables: {
        ...scope.tables,
        users: { ...scope.tables.users, row_filter: null },
      },
    };
    const params = buildQuery(noFilterScope, {
      table: "orders",
      join: ["users"],
    });
    expect(params.joinFilters).toBeUndefined();
  });
});

describe("parseFilterCondition edge cases", () => {
  it("should parse escaped quotes in row_filter values", () => {
    const scopeWithQuotes: ScopedConfig = {
      ...scope,
      tables: {
        ...scope.tables,
        orders: {
          ...scope.tables.orders,
          row_filter: "last_name = 'O''Brien'",
        },
      },
    };
    const params = buildQuery(scopeWithQuotes, { table: "orders" });
    const cond = params.where.find((w) => w.column === "last_name");
    expect(cond).toBeDefined();
    expect(cond!.value).toBe("O'Brien");
  });
});

describe("buildMutateWhere", () => {
  it("should inject row_filter into mutate where conditions", () => {
    const where = buildMutateWhere(scope, "orders", [
      { column: "status", op: "eq", value: "pending" },
    ]);
    // Should have user-provided condition + injected row_filter
    expect(where.length).toBe(2);
    expect(where.find((w) => w.column === "user_id")).toBeDefined();
  });
});
