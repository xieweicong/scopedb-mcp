// scopedb-mcp — Config type definitions

export type AccessMode = "read" | "write";

export interface ColumnDef {
  type: string;
  description?: string;
  references?: string; // e.g. "users.id"
}

export interface TableDef {
  description?: string;
  columns: Record<string, ColumnDef>;
  row_filter?: string | null;
}

export interface ScopeTableDef {
  access: AccessMode | AccessMode[];
  columns: string[];
  writable_columns?: string[];
  row_filter?: string | null;
}

export interface ScopeSettings {
  max_rows?: number;
  max_joins?: number;
  allow_aggregate?: boolean;
}

export interface ScopeDef {
  description?: string;
  context_params?: string[];
  tables: Record<string, ScopeTableDef>;
  settings?: ScopeSettings;
}

export interface DatabaseConfig {
  adapter: string;
  url: string;
  key?: string;
}

export interface GlobalSettings {
  default_scope?: string;
  max_rows?: number;
  max_joins?: number;
  timeout_ms?: number;
  result_format?: "compact" | "full";
  allow_aggregate?: boolean;
  max_queries_per_ask?: number;
  log?: boolean;
}

export interface ScopeDBConfig {
  version: number;
  database: DatabaseConfig;
  tables: Record<string, TableDef>;
  scopes: Record<string, ScopeDef>;
  settings?: GlobalSettings;
}

// --- Resolved types (after scope resolution) ---

export interface ScopedColumn {
  name: string;
  type: string;
  description?: string;
  references?: string;
}

export interface ScopedTable {
  name: string;
  description?: string;
  access: AccessMode[];
  columns: ScopedColumn[];
  writable_columns?: string[];
  row_filter?: string | null;
}

export interface ScopedSettings {
  max_rows: number;
  max_joins: number;
  timeout_ms: number;
  result_format: "compact" | "full";
  allow_aggregate: boolean;
}

export interface ScopedConfig {
  scopeName: string;
  description?: string;
  tables: Record<string, ScopedTable>;
  relations: string[];
  settings: ScopedSettings;
}

// --- Engine input types (shared by permission-guard and query-builder) ---

export interface WhereInput {
  column: string;
  op: string;
  value: unknown;
}

export interface QueryInput {
  table: string;
  select?: string[];
  where?: WhereInput[];
  join?: string[];
  aggregate?: { fn: string; column?: string; group_by?: string };
  order_by?: string;
  order_dir?: "asc" | "desc";
  limit?: number;
}

export interface MutateInput {
  table: string;
  action: string;
  where: WhereInput[];
  data: Record<string, unknown>;
}
