// scopedb-mcp — Schema compiler: ScopedConfig → MCP tool definitions

import type { ScopedConfig } from "../config/types.js";

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Generate MCP tool definitions from a ScopedConfig.
 * Returns 2 tools for read-only scopes, 3 for scopes with write access.
 */
export function generateTools(scope: ScopedConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    generateDescribeTool(),
    generateQueryTool(scope),
  ];

  // Only add db_mutate if any table has write access
  const hasWrite = Object.values(scope.tables).some((t) =>
    t.access.includes("write"),
  );
  if (hasWrite) {
    tools.push(generateMutateTool(scope));
  }

  return tools;
}

function generateDescribeTool(): ToolDefinition {
  return {
    name: "db_describe",
    description:
      "List available tables and columns. Call without args for overview, or with table name for details.",
    inputSchema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          description: "Table name for detailed column info. Omit for overview.",
        },
      },
    },
  };
}

function generateQueryTool(scope: ScopedConfig): ToolDefinition {
  const tableNames = Object.keys(scope.tables);
  const ops = ["eq", "neq", "gt", "lt", "gte", "lte", "like", "in", "is_null"];

  const properties: Record<string, unknown> = {
    table: {
      type: "string",
      description: `Table to query. Available: ${tableNames.join(", ")}`,
    },
    select: {
      type: "array",
      items: { type: "string" },
      description: "Columns to return. 'table.col' for joins. Omit = all visible.",
    },
    where: {
      type: "array",
      items: {
        type: "object",
        required: ["column", "op", "value"],
        properties: {
          column: { type: "string" },
          op: { type: "string", enum: ops },
          value: {},
        },
      },
    },
    join: {
      type: "array",
      items: { type: "string" },
      description: "Tables to join via foreign keys.",
    },
    order_by: { type: "string" },
    order_dir: { type: "string", enum: ["asc", "desc"] },
    limit: { type: "integer" },
  };

  if (scope.settings.allow_aggregate) {
    properties.aggregate = {
      type: "object",
      properties: {
        fn: { type: "string", enum: ["count", "sum", "avg", "min", "max"] },
        column: { type: "string" },
        group_by: { type: "string" },
      },
    };
  }

  return {
    name: "db_query",
    description:
      "Query data with structured parameters. Use db_describe first to understand available tables.",
    inputSchema: {
      type: "object",
      required: ["table"],
      properties,
    },
  };
}

function generateMutateTool(scope: ScopedConfig): ToolDefinition {
  const writableTables = Object.entries(scope.tables)
    .filter(([, t]) => t.access.includes("write"))
    .map(([name]) => name);

  return {
    name: "db_mutate",
    description: `Update data. Only specific columns are writable. Requires WHERE conditions. Writable tables: ${writableTables.join(", ")}`,
    inputSchema: {
      type: "object",
      required: ["table", "action", "where", "data"],
      properties: {
        table: { type: "string" },
        action: { type: "string", enum: ["update"] },
        where: {
          type: "array",
          items: {
            type: "object",
            required: ["column", "op", "value"],
            properties: {
              column: { type: "string" },
              op: { type: "string", enum: ["eq"] },
              value: {},
            },
          },
          minItems: 1,
        },
        data: {
          type: "object",
          description: "Column-value pairs to update",
        },
      },
    },
  };
}
