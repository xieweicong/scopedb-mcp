// scopedb-mcp — Description compression for token optimization

import type { ScopedTable, ScopedColumn } from "../config/types.js";

/**
 * Compress column list into a concise string for tool definitions.
 *
 * Rules:
 * - Omit id columns (AI knows every table has one)
 * - Omit type when it's text (most common)
 * - Only show (description) when it differs from column name
 * - Mark references with → prefix
 *
 * Example output: "name(Full name), department(Department name), role(Role), created_at"
 */
export function compressColumns(columns: ScopedColumn[]): string {
  return columns
    .filter((col) => col.name !== "id")
    .map((col) => {
      let s = col.name;
      if (col.description && col.description !== col.name) {
        s += `(${col.description})`;
      }
      if (col.references) {
        s += `→${col.references.split(".")[0]}`;
      }
      return s;
    })
    .join(", ");
}

/**
 * Build a compact overview for a table, suitable for db_describe overview response.
 */
export function compressTableOverview(table: ScopedTable): {
  description: string;
  access: string;
  columns: string;
} {
  const access = table.access.join(",");
  const columns = compressColumns(table.columns);

  return {
    description: table.description ?? "",
    access,
    columns,
  };
}
