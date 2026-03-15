import { describe, it, expect } from "vitest";
import { resolveScope } from "../resolver.js";
import type { ScopeDBConfig } from "../../config/types.js";

const config: ScopeDBConfig = {
  version: 1,
  database: { adapter: "supabase", url: "https://test.supabase.co", key: "k" },
  tables: {
    users: {
      description: "Employee directory",
      columns: {
        id: { type: "uuid" },
        name: { type: "text", description: "Full name" },
        email: { type: "text" },
        salary: { type: "integer", description: "Annual salary" },
      },
      row_filter: "deleted_at IS NULL",
    },
    orders: {
      description: "Sales orders",
      columns: {
        id: { type: "uuid" },
        user_id: { type: "uuid", references: "users.id" },
        product: { type: "text", description: "Product name" },
        amount: { type: "integer", description: "Amount" },
        status: { type: "text" },
      },
    },
  },
  scopes: {
    support: {
      description: "Support scope",
      tables: {
        users: { access: "read", columns: ["name"] },
        orders: { access: "read", columns: ["product", "amount", "status"] },
      },
      settings: { max_rows: 50 },
    },
    admin: {
      description: "Admin scope",
      tables: {
        users: { access: "read", columns: ["name", "email", "salary"] },
        orders: {
          access: ["read", "write"],
          columns: ["user_id", "product", "amount", "status"],
          writable_columns: ["status"],
        },
      },
    },
    end_user: {
      description: "End user scope",
      context_params: ["current_user_id"],
      tables: {
        orders: {
          access: "read",
          columns: ["product", "amount", "status"],
          row_filter: "user_id = :current_user_id",
        },
      },
      settings: { max_rows: 100 },
    },
  },
  settings: { max_rows: 200, timeout_ms: 5000 },
};

describe("resolveScope", () => {
  it("should resolve support scope with limited columns", () => {
    const scoped = resolveScope(config, "support");
    expect(Object.keys(scoped.tables)).toEqual(["users", "orders"]);
    expect(scoped.tables.users.columns.map((c) => c.name)).toEqual(["name"]);
    expect(scoped.settings.max_rows).toBe(50);
  });

  it("should include table-level row_filter", () => {
    const scoped = resolveScope(config, "support");
    expect(scoped.tables.users.row_filter).toBe("deleted_at IS NULL");
  });

  it("should resolve admin scope with write access", () => {
    const scoped = resolveScope(config, "admin");
    expect(scoped.tables.orders.access).toEqual(["read", "write"]);
    expect(scoped.tables.orders.writable_columns).toEqual(["status"]);
  });

  it("should resolve relations from foreign keys", () => {
    const scoped = resolveScope(config, "admin");
    expect(scoped.relations).toContain("orders.user_id → users.id");
  });

  it("should resolve end_user scope with context params", () => {
    const scoped = resolveScope(config, "end_user", {
      current_user_id: "abc-123",
    });
    expect(scoped.tables.orders.row_filter).toBe("user_id = 'abc-123'");
  });

  it("should throw when context params are missing", () => {
    expect(() => resolveScope(config, "end_user")).toThrow(
      "requires context: current_user_id",
    );
  });

  it("should throw on unknown scope", () => {
    expect(() => resolveScope(config, "nonexistent")).toThrow("not found");
  });

  it("should merge table-level and scope-level row filters", () => {
    // Add a table-level row_filter to orders for this test
    const configWithFilter: ScopeDBConfig = {
      ...config,
      tables: {
        ...config.tables,
        orders: {
          ...config.tables.orders,
          row_filter: "cancelled = false",
        },
      },
    };
    const scoped = resolveScope(configWithFilter, "end_user", {
      current_user_id: "abc",
    });
    expect(scoped.tables.orders.row_filter).toBe(
      "(cancelled = false) AND (user_id = 'abc')",
    );
  });
});
