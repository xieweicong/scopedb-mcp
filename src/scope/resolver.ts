// scopedb-mcp — Scope resolver: scope name → ScopedConfig

import type {
  ScopeDBConfig,
  ScopedConfig,
  ScopedTable,
  ScopedColumn,
  ScopedSettings,
  AccessMode,
} from "../config/types.js";
import { resolveContextParams } from "./context.js";

const DEFAULT_SETTINGS: ScopedSettings = {
  max_rows: 200,
  max_joins: 2,
  timeout_ms: 5000,
  result_format: "compact",
  allow_aggregate: false,
};

/**
 * Resolve a scope by name, producing a ScopedConfig with only
 * the tables/columns/settings visible to that scope.
 */
export function resolveScope(
  config: ScopeDBConfig,
  scopeName: string,
  context?: Record<string, string>,
): ScopedConfig {
  const scopeDef = config.scopes[scopeName];
  if (!scopeDef) {
    throw new Error(
      `Scope '${scopeName}' not found. Available: ${Object.keys(config.scopes).join(", ")}`,
    );
  }

  // Validate context_params
  if (scopeDef.context_params) {
    for (const param of scopeDef.context_params) {
      if (!context || context[param] === undefined) {
        throw new Error(
          `Scope '${scopeName}' requires context: ${param}`,
        );
      }
    }
  }

  const tables: Record<string, ScopedTable> = {};
  const relations: string[] = [];

  for (const [tableName, scopeTable] of Object.entries(scopeDef.tables)) {
    const tableDef = config.tables[tableName];
    if (!tableDef) {
      throw new Error(
        `Scope '${scopeName}' references unknown table '${tableName}'`,
      );
    }

    // Resolve access modes
    const access: AccessMode[] = Array.isArray(scopeTable.access)
      ? scopeTable.access
      : [scopeTable.access];

    // Resolve columns: only include columns defined in both scope and table
    const columns: ScopedColumn[] = [];
    for (const colName of scopeTable.columns) {
      const colDef = tableDef.columns[colName];
      if (!colDef) {
        throw new Error(
          `Scope '${scopeName}' references unknown column '${tableName}.${colName}'`,
        );
      }
      const col: ScopedColumn = {
        name: colName,
        type: colDef.type,
      };
      if (colDef.description) col.description = colDef.description;
      if (colDef.references) {
        // Only expose the relation if the referenced table is in this scope
        const refTable = colDef.references.split(".")[0];
        if (scopeDef.tables[refTable]) {
          col.references = colDef.references;
          relations.push(`${tableName}.${colName} → ${colDef.references}`);
        }
      }
      columns.push(col);
    }

    // Merge row filters: table-level AND scope-level
    let rowFilter: string | null = null;
    const filters: string[] = [];

    if (tableDef.row_filter) {
      filters.push(tableDef.row_filter);
    }
    if (scopeTable.row_filter) {
      let scopeFilter = scopeTable.row_filter;
      if (context) {
        scopeFilter = resolveContextParams(scopeFilter, context);
      }
      filters.push(scopeFilter);
    }

    if (filters.length === 1) {
      rowFilter = filters[0];
    } else if (filters.length > 1) {
      rowFilter = filters.map((f) => `(${f})`).join(" AND ");
    }

    tables[tableName] = {
      name: tableName,
      description: tableDef.description,
      access,
      columns,
      writable_columns: scopeTable.writable_columns,
      row_filter: rowFilter,
    };
  }

  // Merge settings: global defaults < scope overrides
  const globalSettings = config.settings ?? {};
  const scopeSettings = scopeDef.settings ?? {};
  const settings: ScopedSettings = {
    max_rows: scopeSettings.max_rows ?? globalSettings.max_rows ?? DEFAULT_SETTINGS.max_rows,
    max_joins: scopeSettings.max_joins ?? globalSettings.max_joins ?? DEFAULT_SETTINGS.max_joins,
    timeout_ms: globalSettings.timeout_ms ?? DEFAULT_SETTINGS.timeout_ms,
    result_format: globalSettings.result_format ?? DEFAULT_SETTINGS.result_format,
    allow_aggregate:
      scopeSettings.allow_aggregate ?? globalSettings.allow_aggregate ?? DEFAULT_SETTINGS.allow_aggregate,
  };

  return {
    scopeName,
    description: scopeDef.description,
    tables,
    relations,
    settings,
  };
}
