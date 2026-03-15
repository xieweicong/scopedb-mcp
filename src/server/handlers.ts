// scopedb-mcp — MCP tool handlers: db_describe / db_query / db_mutate

import type { ScopedConfig } from "../config/types.js";
import type { DBAdapter } from "../adapters/types.js";
import { guardQuery, guardMutate, PermissionError } from "../engine/permission-guard.js";
import { buildQuery, buildMutateWhere } from "../engine/query-builder.js";
import { formatResult } from "../engine/result-formatter.js";
import { compressTableOverview } from "../compiler/description-compress.js";

interface HandlerContext {
  scope: ScopedConfig;
  adapter: DBAdapter;
  log: boolean;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function success(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

function error(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/**
 * Handle db_describe: return table/column overview or details.
 */
export function handleDescribe(
  ctx: HandlerContext,
  input: { table?: string },
): ToolResult {
  const { scope } = ctx;

  // No table specified → overview
  if (!input.table) {
    const tables: Record<string, { description: string; access: string; columns: string }> = {};
    for (const [name, table] of Object.entries(scope.tables)) {
      tables[name] = compressTableOverview(table);
    }
    return success({
      tables,
      relations: scope.relations,
    });
  }

  // Specific table → column details
  const table = scope.tables[input.table];
  if (!table) {
    return error(
      `Table '${input.table}' not found. Available: ${Object.keys(scope.tables).join(", ")}`,
    );
  }

  const supports: string[] = [];
  if (scope.settings.max_joins > 0) supports.push("join");
  if (scope.settings.allow_aggregate) supports.push("aggregate");
  supports.push("order_by");

  return success({
    table: input.table,
    description: table.description,
    access: table.access.join(","),
    columns: table.columns.map((c) => ({
      name: c.name,
      type: c.type,
      ...(c.description ? { description: c.description } : {}),
      ...(c.references ? { references: c.references } : {}),
    })),
    max_rows: scope.settings.max_rows,
    filterable_ops: ["eq", "neq", "gt", "lt", "gte", "lte", "like", "in", "is_null"],
    supports,
  });
}

/**
 * Handle db_query: validate, build, execute, format.
 */
export async function handleQuery(
  ctx: HandlerContext,
  input: {
    table: string;
    select?: string[];
    where?: { column: string; op: string; value: unknown }[];
    join?: string[];
    aggregate?: { fn: string; column?: string; group_by?: string };
    order_by?: string;
    order_dir?: "asc" | "desc";
    limit?: number;
  },
): Promise<ToolResult> {
  const { scope, adapter, log } = ctx;

  try {
    // 1. Permission check
    guardQuery(scope, input);

    // 2. Build query params
    const params = buildQuery(scope, input);

    // 3. Execute with timeout
    const start = performance.now();
    const result = await Promise.race([
      adapter.query(params),
      timeout(scope.settings.timeout_ms),
    ]);
    const elapsed = Math.round(performance.now() - start);

    // 4. Format result
    const formatted = formatResult(result, scope.settings.result_format, elapsed);

    // 5. Log
    if (log) {
      logQuery(scope.scopeName, input.table, input.join, result.total, elapsed);
    }

    return success(formatted);
  } catch (e) {
    if (e instanceof PermissionError) {
      return error(e.message);
    }
    return error(e instanceof Error ? e.message : "Unknown error");
  }
}

/**
 * Handle db_mutate: validate, execute, return affected rows.
 */
export async function handleMutate(
  ctx: HandlerContext,
  input: {
    table: string;
    action: string;
    where: { column: string; op: string; value: unknown }[];
    data: Record<string, unknown>;
  },
): Promise<ToolResult> {
  const { scope, adapter, log } = ctx;

  try {
    guardMutate(scope, input);

    // Build where with injected row filters (same as query path)
    const where = buildMutateWhere(scope, input.table, input.where);

    // Only return scope-visible columns to prevent leaking hidden fields
    const scopedTable = scope.tables[input.table];
    const returnColumns = scopedTable.columns.map((c) => c.name);

    const start = performance.now();
    const result = await adapter.mutate({
      table: input.table,
      action: input.action as "update",
      where,
      data: input.data,
      returnColumns,
    });
    const elapsed = Math.round(performance.now() - start);

    if (log) {
      console.error(
        `[scopedb] db_mutate scope=${scope.scopeName} table=${input.table} affected=${result.total} (${elapsed}ms)`,
      );
    }

    return success({
      affected: result.total,
      data: result.data,
      ms: elapsed,
    });
  } catch (e) {
    if (e instanceof PermissionError) {
      return error(e.message);
    }
    return error(e instanceof Error ? e.message : "Unknown error");
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Query timeout (${ms}ms)`)), ms),
  );
}

function logQuery(
  scope: string,
  table: string,
  join: string[] | undefined,
  rows: number,
  ms: number,
): void {
  const joinStr = join && join.length > 0 ? ` join=[${join.join(",")}]` : "";
  console.error(
    `[scopedb] db_query scope=${scope} table=${table}${joinStr} rows=${rows} (${ms}ms)`,
  );
}
