// scopedb-mcp — DB Adapter interface

export interface WhereCondition {
  column: string;
  op: string;
  value: unknown;
}

export interface AggregateParams {
  fn: "count" | "sum" | "avg" | "min" | "max";
  column?: string;
  group_by?: string;
}

export interface QueryParams {
  table: string;
  select?: string[];
  where: WhereCondition[];
  join?: string[];
  /** Row filters for joined tables, keyed by table name. */
  joinFilters?: Record<string, WhereCondition[]>;
  aggregate?: AggregateParams;
  order_by?: string;
  order_dir?: "asc" | "desc";
  limit: number;
}

export interface MutateSelectColumns {
  /** Columns to return after mutation (prevents leaking hidden columns). */
  columns: string[];
}

export interface MutateParams {
  table: string;
  action: "update";
  where: WhereCondition[];
  data: Record<string, unknown>;
  /** Columns to return after mutation (scope-visible only). */
  returnColumns?: string[];
}

export interface QueryResult {
  data: Record<string, unknown>[];
  total: number;
}

export interface DBAdapter {
  query(params: QueryParams): Promise<QueryResult>;
  mutate(params: MutateParams): Promise<QueryResult>;
}
