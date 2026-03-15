// scopedb-mcp — Config validation with Zod

import { z } from "zod";

const columnDefSchema = z.object({
  type: z.string(),
  description: z.string().optional(),
  references: z.string().optional(),
});

const tableDefSchema = z.object({
  description: z.string().optional(),
  columns: z.record(z.string(), columnDefSchema),
  row_filter: z.string().nullable().optional(),
});

const accessModeSchema = z.enum(["read", "write"]);

const scopeTableDefSchema = z.object({
  access: z.union([accessModeSchema, z.array(accessModeSchema)]),
  columns: z.array(z.string()),
  writable_columns: z.array(z.string()).optional(),
  row_filter: z.string().nullable().optional(),
});

const scopeSettingsSchema = z.object({
  max_rows: z.number().int().positive().optional(),
  max_joins: z.number().int().min(0).optional(),
  allow_aggregate: z.boolean().optional(),
});

const scopeDefSchema = z.object({
  description: z.string().optional(),
  context_params: z.array(z.string()).optional(),
  tables: z.record(z.string(), scopeTableDefSchema),
  settings: scopeSettingsSchema.optional(),
});

const databaseConfigSchema = z.object({
  adapter: z.string(),
  url: z.string(),
  key: z.string().optional(),
});

const globalSettingsSchema = z.object({
  default_scope: z.string().optional(),
  max_rows: z.number().int().positive().optional(),
  max_joins: z.number().int().min(0).optional(),
  timeout_ms: z.number().int().positive().optional(),
  result_format: z.enum(["compact", "full"]).optional(),
  allow_aggregate: z.boolean().optional(),
  max_queries_per_ask: z.number().int().positive().optional(),
  log: z.boolean().optional(),
});

export const scopeDBConfigSchema = z.object({
  version: z.number().int(),
  database: databaseConfigSchema,
  tables: z.record(z.string(), tableDefSchema),
  scopes: z.record(z.string(), scopeDefSchema),
  settings: globalSettingsSchema.optional(),
});

export function validateConfig(raw: unknown) {
  return scopeDBConfigSchema.parse(raw);
}
