import { describe, it, expect, vi } from "vitest";
import { handleDescribe, handleQuery, handleMutate } from "../handlers.js";
import type { ScopedConfig } from "../../config/types.js";
import type { DBAdapter, QueryResult } from "../../adapters/types.js";

// --- Mock adapter ---

function createMockAdapter(
  queryResult: QueryResult = { data: [], total: 0 },
  mutateResult: QueryResult = { data: [], total: 0 },
): DBAdapter {
  return {
    query: vi.fn().mockResolvedValue(queryResult),
    mutate: vi.fn().mockResolvedValue(mutateResult),
  };
}

// --- Scoped configs ---

const readScope: ScopedConfig = {
  scopeName: "support",
  description: "Support scope",
  tables: {
    users: {
      name: "users",
      description: "User table",
      access: ["read"],
      columns: [
        { name: "name", type: "text", description: "Name" },
        { name: "department", type: "text" },
      ],
    },
    orders: {
      name: "orders",
      description: "Orders",
      access: ["read"],
      columns: [
        { name: "product", type: "text", description: "Product name" },
        { name: "amount", type: "integer", description: "Amount" },
        { name: "status", type: "text" },
      ],
    },
  },
  relations: ["orders.user_id → users.id"],
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

function parse(result: { content: { type: string; text: string }[]; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

// --- Tests ---

describe("handleDescribe", () => {
  const adapter = createMockAdapter();
  const ctx = { scope: readScope, adapter, log: false };

  it("should return overview when no table specified", () => {
    const result = handleDescribe(ctx, {});
    const data = parse(result);

    expect(data.tables).toBeDefined();
    expect(data.tables.users).toBeDefined();
    expect(data.tables.orders).toBeDefined();
    expect(data.relations).toEqual(["orders.user_id → users.id"]);
    expect(result.isError).toBeUndefined();
  });

  it("should return column details for specific table", () => {
    const result = handleDescribe(ctx, { table: "users" });
    const data = parse(result);

    expect(data.table).toBe("users");
    expect(data.columns).toHaveLength(2);
    expect(data.columns[0].name).toBe("name");
    expect(data.max_rows).toBe(50);
  });

  it("should return error for unknown table", () => {
    const result = handleDescribe(ctx, { table: "secret" });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("not found");
  });
});

describe("handleQuery", () => {
  it("should execute valid query and return compact result", async () => {
    const adapter = createMockAdapter({
      data: [
        { name: "Alice", department: "Eng" },
        { name: "Bob", department: "Sales" },
      ],
      total: 2,
    });
    const ctx = { scope: readScope, adapter, log: false };

    const result = await handleQuery(ctx, {
      table: "users",
      select: ["name", "department"],
    });
    const data = parse(result);

    expect(result.isError).toBeUndefined();
    expect(data.cols).toEqual(["name", "department"]);
    expect(data.rows).toEqual([
      ["Alice", "Eng"],
      ["Bob", "Sales"],
    ]);
    expect(data.total).toBe(2);
    expect(data.ms).toBeDefined();
  });

  it("should return permission error for hidden column", async () => {
    const adapter = createMockAdapter();
    const ctx = { scope: readScope, adapter, log: false };

    const result = await handleQuery(ctx, {
      table: "users",
      select: ["salary"],
    });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("not visible");
  });

  it("should return permission error for unknown table", async () => {
    const adapter = createMockAdapter();
    const ctx = { scope: readScope, adapter, log: false };

    const result = await handleQuery(ctx, { table: "secrets" });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("not available");
  });

  it("should reject aggregate when not allowed", async () => {
    const adapter = createMockAdapter();
    const ctx = { scope: readScope, adapter, log: false };

    const result = await handleQuery(ctx, {
      table: "users",
      aggregate: { fn: "count" },
    });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("not allowed");
  });

  it("should handle adapter errors gracefully", async () => {
    const adapter = createMockAdapter();
    (adapter.query as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("connection refused"),
    );
    const ctx = { scope: readScope, adapter, log: false };

    const result = await handleQuery(ctx, { table: "users" });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("connection refused");
  });

  it("should log query when log is enabled", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = createMockAdapter({ data: [], total: 0 });
    const ctx = { scope: readScope, adapter, log: true };

    await handleQuery(ctx, { table: "users" });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("db_query"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("scope=support"));
    spy.mockRestore();
  });
});

describe("handleMutate", () => {
  it("should execute valid mutation", async () => {
    const adapter = createMockAdapter(undefined, {
      data: [{ product: "PC", status: "shipped" }],
      total: 1,
    });
    const ctx = { scope: writeScope, adapter, log: false };

    const result = await handleMutate(ctx, {
      table: "orders",
      action: "update",
      where: [{ column: "product", op: "eq", value: "PC" }],
      data: { status: "shipped" },
    });
    const data = parse(result);

    expect(result.isError).toBeUndefined();
    expect(data.affected).toBe(1);
    expect(data.data).toEqual([{ product: "PC", status: "shipped" }]);
  });

  it("should reject mutation on read-only scope", async () => {
    const adapter = createMockAdapter();
    const ctx = { scope: readScope, adapter, log: false };

    const result = await handleMutate(ctx, {
      table: "users",
      action: "update",
      where: [{ column: "name", op: "eq", value: "x" }],
      data: { name: "y" },
    });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("write access");
  });

  it("should reject non-writable column", async () => {
    const adapter = createMockAdapter();
    const ctx = { scope: writeScope, adapter, log: false };

    const result = await handleMutate(ctx, {
      table: "orders",
      action: "update",
      where: [{ column: "product", op: "eq", value: "x" }],
      data: { product: "hacked" },
    });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("not writable");
  });

  it("should reject mutation without WHERE", async () => {
    const adapter = createMockAdapter();
    const ctx = { scope: writeScope, adapter, log: false };

    const result = await handleMutate(ctx, {
      table: "orders",
      action: "update",
      where: [],
      data: { status: "x" },
    });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("at least one WHERE");
  });
});
