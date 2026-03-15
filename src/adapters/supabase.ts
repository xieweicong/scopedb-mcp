// scopedb-mcp — Supabase adapter

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DBAdapter, QueryParams, MutateParams, QueryResult } from "./types.js";

/** Safety cap: max rows fetched for client-side aggregation to prevent OOM. */
const MAX_AGGREGATE_ROWS = 10_000;

export class SupabaseAdapter implements DBAdapter {
  private client: SupabaseClient;

  constructor(url: string, key: string) {
    this.client = createClient(url, key);
  }

  async query(params: QueryParams): Promise<QueryResult> {
    // Handle aggregate queries separately
    if (params.aggregate) {
      return this.queryAggregate(params);
    }

    const selectStr = this.buildSelect(params.select, params.join, params.joinFilters);

    let q = this.client
      .from(params.table)
      .select(selectStr, { count: "exact" });

    // Apply where conditions on the base table
    for (const w of params.where) {
      q = this.applyOp(q, w.column, w.op, w.value);
    }

    // Apply filters on joined tables (e.g. users.deleted_at IS NULL)
    if (params.joinFilters) {
      for (const [joinTable, filters] of Object.entries(params.joinFilters)) {
        for (const f of filters) {
          q = this.applyOp(q, `${joinTable}.${f.column}`, f.op, f.value);
        }
      }
    }

    // Apply ordering
    if (params.order_by) {
      q = q.order(params.order_by, {
        ascending: params.order_dir !== "desc",
      });
    }

    // Apply limit
    q = q.limit(params.limit);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return { data: rows, total: count ?? rows.length };
  }

  /**
   * Execute an aggregate query using Supabase RPC or client-side aggregation.
   * Supabase doesn't natively support SQL aggregates via PostgREST,
   * so we fetch the relevant data and compute client-side.
   */
  private async queryAggregate(params: QueryParams): Promise<QueryResult> {
    const agg = params.aggregate!;
    const columns = agg.column ? [agg.column] : [];
    if (agg.group_by && !columns.includes(agg.group_by)) {
      columns.push(agg.group_by);
    }

    // Build select — include join relations with !inner if they have filters
    let selectStr = columns.length > 0 ? columns.join(", ") : "*";
    if (params.joinFilters && Object.keys(params.joinFilters).length > 0) {
      // Add !inner join selects so Supabase enforces the row filter on related tables
      const joinParts = Object.keys(params.joinFilters).map(
        (t) => `${t}!inner(id)`,
      );
      selectStr = [selectStr, ...joinParts].join(", ");
    }

    let q = this.client
      .from(params.table)
      .select(selectStr, { count: "exact" });

    // Apply base table where conditions
    for (const w of params.where) {
      q = this.applyOp(q, w.column, w.op, w.value);
    }

    // Apply join table filters (same as normal query path)
    if (params.joinFilters) {
      for (const [joinTable, filters] of Object.entries(params.joinFilters)) {
        for (const f of filters) {
          q = this.applyOp(q, `${joinTable}.${f.column}`, f.op, f.value);
        }
      }
    }

    // For count-only without group_by, we can use count from response header
    if (agg.fn === "count" && !agg.column && !agg.group_by) {
      const { count, error } = await q.limit(0);
      if (error) throw new Error(error.message);
      return {
        data: [{ count: count ?? 0 }],
        total: 1,
      };
    }

    // Fetch matching rows for aggregation (capped for safety).
    // Do NOT apply params.limit here — limit is for result pagination,
    // not for aggregate input. Truncating would silently produce wrong sums/avgs.
    const { data, error, count } = await q.limit(MAX_AGGREGATE_ROWS);
    if (error) throw new Error(error.message);

    if ((count ?? 0) > MAX_AGGREGATE_ROWS) {
      throw new Error(
        `Aggregate query matched ${count} rows, exceeding safety limit of ${MAX_AGGREGATE_ROWS}. ` +
        `Add more WHERE conditions to narrow the dataset.`,
      );
    }

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    if (rows.length === 0) {
      return { data: [{ [agg.fn]: null }], total: 1 };
    }

    if (agg.group_by) {
      return this.aggregateGrouped(rows, agg, params);
    }
    return this.aggregateSimple(rows, agg);
  }

  private aggregateSimple(
    rows: Record<string, unknown>[],
    agg: { fn: string; column?: string },
  ): QueryResult {
    const result = computeAggregate(rows, agg.fn, agg.column);
    return { data: [{ [agg.fn]: result }], total: 1 };
  }

  private aggregateGrouped(
    rows: Record<string, unknown>[],
    agg: { fn: string; column?: string; group_by?: string },
    params: QueryParams,
  ): QueryResult {
    const groups = new Map<unknown, Record<string, unknown>[]>();
    for (const row of rows) {
      const key = row[agg.group_by!];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    let data = [...groups.entries()].map(([key, groupRows]) => ({
      [agg.group_by!]: key,
      [agg.fn]: computeAggregate(groupRows, agg.fn, agg.column),
    }));

    // Apply ordering on aggregated results
    if (params.order_by) {
      const sortKey = params.order_by;
      const ascending = params.order_dir !== "desc";
      data.sort((a, b) => {
        const va = a[sortKey] ?? 0;
        const vb = b[sortKey] ?? 0;
        if (va < vb) return ascending ? -1 : 1;
        if (va > vb) return ascending ? 1 : -1;
        return 0;
      });
    }

    // Apply limit on aggregated results
    if (params.limit && data.length > params.limit) {
      data = data.slice(0, params.limit);
    }

    return { data, total: data.length };
  }

  async mutate(params: MutateParams): Promise<QueryResult> {
    let q = this.client.from(params.table).update(params.data);

    for (const w of params.where) {
      q = this.applyOp(q, w.column, w.op, w.value);
    }

    // Only select scope-visible columns to prevent leaking hidden fields
    const selectStr = params.returnColumns
      ? params.returnColumns.join(", ")
      : "*";
    const { data, error } = await q.select(selectStr);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return { data: rows, total: rows.length };
  }

  private buildSelect(
    columns?: string[],
    joins?: string[],
    joinFilters?: Record<string, import("./types.js").WhereCondition[]>,
  ): string {
    if (!columns) return "*";
    // Empty array means no columns selected — this should not happen
    // (query-builder always populates from scope), but guard against it.
    if (columns.length === 0) {
      throw new Error("No columns to select — this indicates a scope or query-builder bug");
    }

    const direct = columns.filter((c) => !c.includes("."));
    const joinCols: Record<string, string[]> = {};

    for (const col of columns.filter((c) => c.includes("."))) {
      const [table, field] = col.split(".");
      (joinCols[table] ??= []).push(field);
    }

    // Join tables should already have explicit columns from query-builder.
    // Never fall back to "*" — that would leak columns outside the scope.

    // Use !inner for joined tables that have row filters,
    // so rows excluded by the filter are also excluded from the base result.
    const tablesWithFilters = new Set(Object.keys(joinFilters ?? {}));
    const joinParts = Object.entries(joinCols).map(([t, cols]) => {
      const qualifier = tablesWithFilters.has(t) ? "!inner" : "";
      return `${t}${qualifier}(${cols.join(",")})`;
    });

    return [...direct, ...joinParts].join(", ");
  }

  private applyOp(q: any, column: string, op: string, value: unknown): any {
    switch (op) {
      case "eq":
        return q.eq(column, value);
      case "neq":
        return q.neq(column, value);
      case "gt":
        return q.gt(column, value);
      case "lt":
        return q.lt(column, value);
      case "gte":
        return q.gte(column, value);
      case "lte":
        return q.lte(column, value);
      case "like":
        return q.like(column, value);
      case "in":
        return q.in(column, value);
      case "is_null":
        return q.is(column, null);
      case "is_not_null":
        return q.not(column, "is", null);
      default:
        throw new Error(`Unknown operator: ${op}`);
    }
  }
}

function computeAggregate(
  rows: Record<string, unknown>[],
  fn: string,
  column?: string,
): number | null {
  if (fn === "count") {
    // COUNT(*) counts all rows; COUNT(column) skips nulls (standard SQL)
    if (!column) return rows.length;
    return rows.filter((r) => r[column] != null).length;
  }

  if (!column) return null;
  const values = rows
    .map((r) => r[column])
    .filter((v): v is number => typeof v === "number");

  if (values.length === 0) return null;

  switch (fn) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return values.reduce((a, b) => (b < a ? b : a), values[0]);
    case "max":
      return values.reduce((a, b) => (b > a ? b : a), values[0]);
    default:
      return null;
  }
}
