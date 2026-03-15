// scopedb-mcp — Query Builder: structured params → adapter call params

import type { ScopedConfig, ScopedTable, QueryInput } from "../config/types.js";
import type { QueryParams, WhereCondition } from "../adapters/types.js";

/**
 * Build adapter-ready QueryParams from a validated tool call input.
 * Injects row filters and enforces limits from scope config.
 */
export function buildQuery(scope: ScopedConfig, input: QueryInput): QueryParams {
  const table = scope.tables[input.table];

  // Build where conditions from user input
  const where: WhereCondition[] = [];

  if (input.where) {
    for (const w of input.where) {
      where.push({
        column: w.column,
        op: w.op,
        value: w.value,
      });
    }
  }

  // Inject row filters (table-level + scope-level, already merged by resolver)
  injectRowFilters(table, where);

  // Enforce limit: min of (request, scope, global)
  const limit = Math.min(
    input.limit ?? scope.settings.max_rows,
    scope.settings.max_rows,
  );

  // Resolve select columns
  let select = input.select ?? table.columns.map((c) => c.name);

  // For explicit joins without dotted selects, expand to scope-visible columns
  // to prevent Supabase from returning `table(*)` which leaks hidden columns.
  if (input.join) {
    const dottedTables = new Set(
      select.filter((c) => c.includes(".")).map((c) => c.split(".")[0]),
    );
    for (const joinTable of input.join) {
      if (!dottedTables.has(joinTable)) {
        const jt = scope.tables[joinTable];
        if (jt) {
          const joinCols = jt.columns.map((c) => `${joinTable}.${c.name}`);
          select = [...select, ...joinCols];
        }
      }
    }
  }

  // Collect row filters for joined tables
  const allJoinTables = collectJoinTables(select, input.join);
  let joinFilters: Record<string, WhereCondition[]> | undefined;
  for (const joinTableName of allJoinTables) {
    const jt = scope.tables[joinTableName];
    if (jt?.row_filter) {
      const jtWhere: WhereCondition[] = [];
      injectRowFilters(jt, jtWhere);
      if (jtWhere.length > 0) {
        joinFilters ??= {};
        joinFilters[joinTableName] = jtWhere;
      }
    }
  }

  return {
    table: input.table,
    select,
    where,
    join: input.join,
    joinFilters,
    aggregate: input.aggregate as QueryParams["aggregate"],
    order_by: input.order_by,
    order_dir: input.order_dir,
    limit,
  };
}

/**
 * Build where conditions for a mutate operation.
 * Includes user-provided where + injected row filters.
 */
export function buildMutateWhere(
  scope: ScopedConfig,
  tableName: string,
  userWhere: { column: string; op: string; value: unknown }[],
): WhereCondition[] {
  const table = scope.tables[tableName];
  const where: WhereCondition[] = userWhere.map((w) => ({
    column: w.column,
    op: w.op,
    value: w.value,
  }));
  injectRowFilters(table, where);
  return where;
}

/**
 * Parse row_filter string into structured WhereConditions.
 *
 * Supports these patterns (covers all config examples):
 *   "column IS NULL"           → { column, op: "is_null", value: null }
 *   "column = 'value'"         → { column, op: "eq", value: "value" }
 *   "column = value"           → { column, op: "eq", value: "value" }
 *
 * Multiple conditions joined by AND are split and each parsed independently.
 * Parenthesized groups like "(a) AND (b)" are unwrapped.
 */
function injectRowFilters(table: ScopedTable, where: WhereCondition[]): void {
  if (!table.row_filter) return;

  const conditions = splitAndConditions(table.row_filter);
  for (const cond of conditions) {
    where.push(parseFilterCondition(cond));
  }
}

function splitAndConditions(filter: string): string[] {
  // Split on " AND " (case-insensitive), then strip outer parens
  return filter
    .split(/\s+AND\s+/i)
    .map((s) => s.trim())
    .map((s) => {
      // Strip outer parens: "(expr)" → "expr"
      if (s.startsWith("(") && s.endsWith(")")) {
        return s.slice(1, -1).trim();
      }
      return s;
    });
}

function parseFilterCondition(cond: string): WhereCondition {
  // "column IS NULL"
  const isNullMatch = cond.match(/^(\w+)\s+IS\s+NULL$/i);
  if (isNullMatch) {
    return { column: isNullMatch[1], op: "is_null", value: null };
  }

  // "column IS NOT NULL"
  const isNotNullMatch = cond.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
  if (isNotNullMatch) {
    return { column: isNotNullMatch[1], op: "is_not_null", value: null };
  }

  // "column op 'value'" (value may contain escaped quotes like O''Brien)
  const quotedMatch = cond.match(/^(\w+)\s*(=|!=|>=|<=|>|<)\s*'((?:[^']|'')*?)'\s*$/);
  if (quotedMatch) {
    const [, column, sqlOp, rawValue] = quotedMatch;
    // Unescape SQL-style doubled quotes: O''Brien → O'Brien
    const value = rawValue.replace(/''/g, "'");
    const op = sqlOpToOp(sqlOp);
    return { column, op, value };
  }

  // "column op value" (unquoted — numeric or simple identifier)
  const unquotedMatch = cond.match(/^(\w+)\s*(=|!=|>=|<=|>|<)\s*(\S+)\s*$/);
  if (unquotedMatch) {
    const [, column, sqlOp, value] = unquotedMatch;
    const op = sqlOpToOp(sqlOp);
    return { column, op, value };
  }

  throw new Error(
    `Cannot parse row_filter condition: "${cond}". ` +
    `Supported: "col = 'val'", "col IS NULL", "col IS NOT NULL"`,
  );
}

/**
 * Collect all join table names from dotted selects and explicit join list.
 */
function collectJoinTables(select: string[], explicitJoins?: string[]): Set<string> {
  const tables = new Set<string>();
  for (const col of select) {
    if (col.includes(".")) {
      tables.add(col.split(".")[0]);
    }
  }
  if (explicitJoins) {
    for (const j of explicitJoins) {
      tables.add(j);
    }
  }
  return tables;
}

function sqlOpToOp(sqlOp: string): string {
  switch (sqlOp) {
    case "=": return "eq";
    case "!=": return "neq";
    case ">": return "gt";
    case "<": return "lt";
    case ">=": return "gte";
    case "<=": return "lte";
    default: return "eq";
  }
}
