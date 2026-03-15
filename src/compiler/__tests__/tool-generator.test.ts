import { describe, it, expect } from "vitest";
import { generateTools } from "../tool-generator.js";
import type { ScopedConfig } from "../../config/types.js";

const readOnlyScope: ScopedConfig = {
  scopeName: "support",
  tables: {
    users: {
      name: "users",
      access: ["read"],
      columns: [{ name: "name", type: "text" }],
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
      columns: [{ name: "status", type: "text" }],
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

describe("generateTools", () => {
  it("should generate 2 tools for read-only scope", () => {
    const tools = generateTools(readOnlyScope);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(["db_describe", "db_query"]);
  });

  it("should generate 3 tools for write scope", () => {
    const tools = generateTools(writeScope);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      "db_describe",
      "db_query",
      "db_mutate",
    ]);
  });

  it("should include aggregate in query tool when allowed", () => {
    const tools = generateTools(writeScope);
    const queryTool = tools.find((t) => t.name === "db_query")!;
    const props = queryTool.inputSchema.properties as Record<string, unknown>;
    expect(props.aggregate).toBeDefined();
  });

  it("should not include aggregate in query tool when not allowed", () => {
    const tools = generateTools(readOnlyScope);
    const queryTool = tools.find((t) => t.name === "db_query")!;
    const props = queryTool.inputSchema.properties as Record<string, unknown>;
    expect(props.aggregate).toBeUndefined();
  });
});
