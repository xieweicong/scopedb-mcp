// scopedb-mcp — Permission Guard: validate tool calls against scope

import type { ScopedConfig, QueryInput, MutateInput } from "../config/types.js";

const VALID_OPS = new Set(["eq", "neq", "gt", "lt", "gte", "lte", "like", "in", "is_null"]);

/**
 * Validate a db_query tool call against the scoped config.
 * Throws descriptive errors on permission violations.
 */
export function guardQuery(scope: ScopedConfig, input: QueryInput): void {
  const table = scope.tables[input.table];
  if (!table) {
    throw new PermissionError(
      `Table '${input.table}' is not available. Available: ${Object.keys(scope.tables).join(", ")}`,
    );
  }

  if (!table.access.includes("read")) {
    throw new PermissionError(`Table '${input.table}' does not have read access`);
  }

  // Collect implicit joins from dotted selects (e.g. "users.name")
  const implicitJoins = new Set<string>();

  // Validate selected columns
  const visibleCols = new Set(table.columns.map((c) => c.name));
  if (input.select) {
    for (const col of input.select) {
      // "table.col" syntax implies a join
      if (col.includes(".")) {
        const [joinTable, joinCol] = col.split(".");
        implicitJoins.add(joinTable);
        const jt = scope.tables[joinTable];
        if (!jt) {
          throw new PermissionError(`Join table '${joinTable}' is not available`);
        }
        if (!jt.access.includes("read")) {
          throw new PermissionError(`Join table '${joinTable}' does not have read access`);
        }
        const jtCols = new Set(jt.columns.map((c) => c.name));
        if (!jtCols.has(joinCol)) {
          throw new PermissionError(
            `Column '${joinCol}' is not visible in table '${joinTable}'`,
          );
        }
        continue;
      }
      if (!visibleCols.has(col)) {
        throw new PermissionError(
          `Column '${col}' is not visible in table '${input.table}'. Visible: ${[...visibleCols].join(", ")}`,
        );
      }
    }
  }

  // Validate where columns
  if (input.where) {
    for (const w of input.where) {
      if (!visibleCols.has(w.column)) {
        throw new PermissionError(
          `Cannot filter on hidden column '${w.column}' in table '${input.table}'`,
        );
      }
      if (!VALID_OPS.has(w.op)) {
        throw new PermissionError(
          `Invalid operator '${w.op}'. Valid: ${[...VALID_OPS].join(", ")}`,
        );
      }
    }
  }

  // Merge explicit joins + implicit joins from dotted selects
  const explicitJoins = new Set(input.join ?? []);
  const allJoins = new Set([...explicitJoins, ...implicitJoins]);

  // Validate all joins (explicit + implicit)
  if (allJoins.size > 0) {
    if (allJoins.size > scope.settings.max_joins) {
      throw new PermissionError(
        `Too many joins: ${allJoins.size} (max: ${scope.settings.max_joins})`,
      );
    }
    for (const joinTable of allJoins) {
      if (!scope.tables[joinTable]) {
        throw new PermissionError(`Join table '${joinTable}' is not available in this scope`);
      }
      if (!scope.tables[joinTable].access.includes("read")) {
        throw new PermissionError(`Join table '${joinTable}' does not have read access`);
      }
    }
  }

  // Validate aggregate
  if (input.aggregate) {
    if (!scope.settings.allow_aggregate) {
      throw new PermissionError("Aggregate queries are not allowed in this scope");
    }
    if (input.aggregate.column && !visibleCols.has(input.aggregate.column)) {
      throw new PermissionError(
        `Cannot aggregate on hidden column '${input.aggregate.column}'`,
      );
    }
    if (input.aggregate.group_by && !visibleCols.has(input.aggregate.group_by)) {
      throw new PermissionError(
        `Cannot group by hidden column '${input.aggregate.group_by}'`,
      );
    }
  }

  // Validate order_by
  if (input.order_by && !visibleCols.has(input.order_by)) {
    throw new PermissionError(
      `Cannot order by hidden column '${input.order_by}'`,
    );
  }

  // Validate limit
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new PermissionError("Limit must be a positive integer");
    }
  }
}

/**
 * Validate a db_mutate tool call against the scoped config.
 */
export function guardMutate(scope: ScopedConfig, input: MutateInput): void {
  const table = scope.tables[input.table];
  if (!table) {
    throw new PermissionError(
      `Table '${input.table}' is not available. Available: ${Object.keys(scope.tables).join(", ")}`,
    );
  }

  if (!table.access.includes("write")) {
    throw new PermissionError(`Table '${input.table}' does not have write access`);
  }

  if (input.action !== "update") {
    throw new PermissionError(`Action '${input.action}' is not supported. Only 'update' is allowed`);
  }

  if (!input.where || input.where.length === 0) {
    throw new PermissionError("Mutate requires at least one WHERE condition");
  }

  // Validate writable columns
  const writableCols = new Set(table.writable_columns ?? []);
  if (writableCols.size === 0) {
    throw new PermissionError(`Table '${input.table}' has no writable columns defined`);
  }

  for (const col of Object.keys(input.data)) {
    if (!writableCols.has(col)) {
      throw new PermissionError(
        `Column '${col}' is not writable in table '${input.table}'. Writable: ${[...writableCols].join(", ")}`,
      );
    }
  }

  // Validate where columns are visible
  const visibleCols = new Set(table.columns.map((c) => c.name));
  for (const w of input.where) {
    if (!visibleCols.has(w.column)) {
      throw new PermissionError(
        `Cannot filter on hidden column '${w.column}' in table '${input.table}'`,
      );
    }
  }
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}
