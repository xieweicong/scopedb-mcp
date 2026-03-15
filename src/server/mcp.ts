// scopedb-mcp — MCP Server setup + tool registration

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "../config/loader.js";
import { resolveScope } from "../scope/resolver.js";
import { generateTools } from "../compiler/tool-generator.js";
import { handleDescribe, handleQuery, handleMutate } from "./handlers.js";
import { SupabaseAdapter } from "../adapters/supabase.js";
import type { DBAdapter } from "../adapters/types.js";
import type { ScopedConfig } from "../config/types.js";

interface ServeOptions {
  configPath: string;
  scopeName?: string;
  context?: Record<string, string>;
}

export function parseContextEnv(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("SCOPEDB_CONTEXT must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SCOPEDB_CONTEXT must be a JSON object");
  }

  const context: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || typeof value === "object") {
      throw new Error(`SCOPEDB_CONTEXT value for '${key}' must be a string, number, or boolean`);
    }
    context[key] = String(value);
  }

  return context;
}

export function getServeOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ServeOptions {
  return {
    configPath: env.SCOPEDB_CONFIG ?? "./scopedb.config.yaml",
    scopeName: env.SCOPEDB_SCOPE,
    context: parseContextEnv(env.SCOPEDB_CONTEXT),
  };
}

/**
 * Create and start an MCP server for a given scope.
 */
export async function serve(options: ServeOptions): Promise<void> {
  // 1. Load config
  const config = loadConfig(options.configPath);
  const scopeName =
    options.scopeName ?? config.settings?.default_scope ?? Object.keys(config.scopes)[0];
  const scope = resolveScope(config, scopeName, options.context);

  // 2. Create adapter
  const adapter = createAdapter(config.database.adapter, config.database.url, config.database.key);

  // 3. Create MCP server
  const server = new McpServer({
    name: `scopedb-${scopeName}`,
    version: "0.1.0",
  });

  const log = config.settings?.log ?? true;
  const ctx = { scope, adapter, log };

  // 4. Register tools
  registerTools(server, ctx);

  // 5. Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[scopedb] MCP server started (scope: ${scopeName})`);
}

function createAdapter(adapterType: string, url: string, key?: string): DBAdapter {
  switch (adapterType) {
    case "supabase":
      if (!key) throw new Error("Supabase adapter requires a key");
      return new SupabaseAdapter(url, key);
    default:
      throw new Error(`Unsupported adapter: ${adapterType}. Currently supported: supabase`);
  }
}

function registerTools(
  server: McpServer,
  ctx: { scope: ScopedConfig; adapter: DBAdapter; log: boolean },
): void {
  const tools = generateTools(ctx.scope);

  // db_describe
  server.tool(
    "db_describe",
    tools.find((t) => t.name === "db_describe")!.description,
    { table: z.string().optional() },
    async ({ table }) => {
      return handleDescribe(ctx, { table });
    },
  );

  // db_query — only include aggregate field if scope allows it
  const querySchema: Record<string, z.ZodTypeAny> = {
    table: z.string(),
    select: z.array(z.string()).optional(),
    where: z
      .array(
        z.object({
          column: z.string(),
          op: z.string(),
          value: z.any(),
        }),
      )
      .optional(),
    join: z.array(z.string()).optional(),
    order_by: z.string().optional(),
    order_dir: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().positive().optional(),
  };

  if (ctx.scope.settings.allow_aggregate) {
    querySchema.aggregate = z
      .object({
        fn: z.enum(["count", "sum", "avg", "min", "max"]),
        column: z.string().optional(),
        group_by: z.string().optional(),
      })
      .optional();
  }

  server.tool(
    "db_query",
    tools.find((t) => t.name === "db_query")!.description,
    querySchema,
    async (input) => {
      return handleQuery(ctx, input as any);
    },
  );

  // db_mutate (only if scope has write access)
  const hasWrite = Object.values(ctx.scope.tables).some((t) =>
    t.access.includes("write"),
  );
  if (hasWrite) {
    server.tool(
      "db_mutate",
      tools.find((t) => t.name === "db_mutate")!.description,
      {
        table: z.string(),
        action: z.enum(["update"]),
        where: z
          .array(
            z.object({
              column: z.string(),
              op: z.enum(["eq"]),
              value: z.any(),
            }),
          )
          .min(1),
        data: z.record(z.string(), z.any()),
      },
      async (input) => {
        return handleMutate(ctx, input as any);
      },
    );
  }
}

// Allow direct execution: node dist/server/mcp.js
const isDirectRun =
  process.argv[1]?.endsWith("server/mcp.js") ||
  process.argv[1]?.endsWith("server/mcp");

if (isDirectRun) {
  const options = getServeOptionsFromEnv();
  serve(options).catch((err) => {
    console.error("[scopedb] Fatal:", err.message);
    process.exit(1);
  });
}
