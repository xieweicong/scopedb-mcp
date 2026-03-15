// scopedb-mcp — Library entry point

export { loadConfig } from "./config/loader.js";
export { resolveScope } from "./scope/resolver.js";
export { generateTools } from "./compiler/tool-generator.js";
export { serve } from "./server/mcp.js";
export { handleDescribe, handleQuery, handleMutate } from "./server/handlers.js";
export { SupabaseAdapter } from "./adapters/supabase.js";

export type {
  ScopeDBConfig,
  ScopedConfig,
  ScopedTable,
  ScopedColumn,
  ScopedSettings,
  QueryInput,
  MutateInput,
} from "./config/types.js";

export type { DBAdapter } from "./adapters/types.js";
