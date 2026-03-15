<div align="center">

# ScopeDB MCP

**Give AI database access without giving it your whole database.**

Config-driven MCP server and TypeScript library for scoped, auditable AI data access.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-green.svg)](https://modelcontextprotocol.io/)

[中文](./README.zh.md) | [日本語](./README.ja.md)

</div>

---

ScopeDB lets AI fetch the data it needs on its own, but only inside the boundaries you define in YAML:

```yaml
scopes:
  support:
    tables:
      users:  { access: read, columns: [name] }
      orders: { access: read, columns: [product, amount, status] }
    settings: { max_rows: 50, max_joins: 1 }
```

The result is a better default for AI products:

- **No manual context assembly** — stop hardcoding what data to fetch before every model call.
- **No full-database exposure** — the AI only sees allowed tables, columns, rows, and operations.
- **No raw SQL prompting** — queries are structured, validated, and bounded by scope settings.
- **No code rewrite when requirements change** — update the config, not your app logic.

## Why ScopeDB

| Approach | What you get | What breaks |
|----------|--------------|-------------|
| Manual context assembly | Tight control | Rigid code, lots of glue logic, AI cannot explore follow-up questions |
| Raw SQL / full DB access | Flexible querying | Security risk, token bloat, accidental exposure of sensitive data |
| **ScopeDB** | AI autonomy with scoped access | You define the boundary once, and the tools stay inside it |

## How Teams Usually Solve This Today

Traditionally, teams piece this together from multiple layers:

- **Database-level controls** like RLS, views, read-only roles, or restricted schemas
- **Application-level APIs** like `getRecentOrders(userId)` or `updateOrderStatus(orderId)`
- **Manual context assembly** that fetches data ahead of each model call

That approach works, but it usually means a lot of glue code between your database, your backend, and your AI layer.

ScopeDB is not trying to replace fundamentals like RLS. It packages the AI-facing part of that stack into one reusable layer: declare the boundary once, generate tools from config, and let the model operate autonomously inside those rules. If you already use RLS, ScopeDB sits above it as the scoped access layer for AI.

## What It Feels Like

One app can expose different database capabilities to different AI workflows without writing custom query code for each one:

| Scope | AI can do | AI cannot do |
|-------|-----------|--------------|
| `support` | Read customer names and order status | See emails, salaries, or internal notes |
| `analytics` | Join tables, aggregate revenue, compare trends | Read hidden columns outside the analytics view |
| `admin` | Update specific fields like `orders.status` | Write arbitrary columns or mutate every table |

Example:

> User asks: "Show me Alice's latest order."
>
> In `support`, the AI can answer by reading `users.name` and `orders.status`.
>
> If it tries: "What is Alice's salary?" ScopeDB rejects the request because `salary` is not visible.

## What You Get

- **Scoped table and column visibility** for support agents, analytics tools, and internal copilots
- **Row-level filters** for multi-tenant or user-specific data access
- **Controlled JOINs and aggregation** for analytics use cases
- **Write access to specific columns only** when you want AI to make safe updates
- **Two integration modes**: standalone MCP server or TypeScript library inside your backend

## Use Cases

| Scenario | Description |
|----------|-------------|
| **Backend AI Features** | AI autonomously fetches relevant data to generate responses — no manual context assembly, no unnecessary exposure |
| **Support Agent** | Sees customer names and order status only — no emails, salaries, or internal notes |
| **Data Analytics** | Cross-table JOINs and aggregation, but cost prices and internal notes hidden |
| **Admin Dashboard** | Write access to specific columns only (e.g., order status) |
| **Multi-tenant SaaS** | `context_params` injects `user_id` — each user sees only their own data |
| **Internal Tools** | Natural language database queries — no SQL required |

## How The Boundary Is Enforced

<div align="center">

```
Request → Scope Isolation → Permission Guard → Structured Query Builder → Row Filter Injection → Resource Limits
```

</div>

1. **Scope Isolation** — each scope only sees tables and columns declared in config
2. **Permission Guard** — validates access mode, column access, operator whitelist
3. **Structured Queries** — no raw SQL; all parameters validated before query construction
4. **Row Filter Injection** — table-level + scope-level filters automatically merged and injected
5. **Resource Limits** — max_rows / max_joins prevent oversized queries

## Quick Start

### 1. Install

```bash
pnpm install scopedb-mcp
# or
npm install scopedb-mcp
```

### 2. Create Config

Create `scopedb.config.yaml`:

```yaml
version: 1

database:
  adapter: supabase
  url: ${SUPABASE_URL}
  key: ${SUPABASE_SERVICE_KEY}

tables:
  users:
    description: "User profiles"
    columns:
      id:     { type: uuid }
      name:   { type: text, description: "Full name" }
      email:  { type: text, description: "Email address" }
      salary: { type: integer, description: "Annual salary" }
    row_filter: "deleted_at IS NULL"

  orders:
    description: "Order records"
    columns:
      id:       { type: uuid }
      user_id:  { type: uuid, references: users.id }
      product:  { type: text, description: "Product name" }
      amount:   { type: integer, description: "Total amount" }
      status:   { type: text, description: "pending / confirmed / shipped" }

scopes:
  support:
    description: "Customer support — minimal access"
    tables:
      users:  { access: read, columns: [name] }
      orders: { access: read, columns: [product, amount, status] }
    settings:
      max_rows: 50
      max_joins: 1

  analytics:
    description: "Analytics — aggregation allowed, no sensitive data"
    tables:
      users:  { access: read, columns: [name] }
      orders: { access: read, columns: [user_id, product, amount, status] }
    settings:
      max_rows: 500
      max_joins: 3
      allow_aggregate: true

  admin:
    description: "Admin — write access to specific columns"
    tables:
      orders:
        access: [read, write]
        columns: [user_id, product, amount, status]
        writable_columns: [status]
    settings:
      max_rows: 1000

settings:
  default_scope: support
  max_rows: 200
  timeout_ms: 5000
  result_format: compact
```

### 3. Connect to Claude Code

```bash
claude mcp add scopedb-support \
  -e SUPABASE_URL=https://xxx.supabase.co \
  -e SUPABASE_SERVICE_KEY=your-key \
  -e SCOPEDB_CONFIG=./scopedb.config.yaml \
  -e SCOPEDB_SCOPE=support \
  -- node /path/to/scopedb-mcp/dist/server/mcp.js
```

Or add to Claude Desktop config:

```json
{
  "mcpServers": {
    "scopedb-support": {
      "command": "node",
      "args": ["/path/to/scopedb-mcp/dist/server/mcp.js"],
      "env": {
        "SUPABASE_URL": "https://xxx.supabase.co",
        "SUPABASE_SERVICE_KEY": "your-key",
        "SCOPEDB_CONFIG": "./scopedb.config.yaml",
        "SCOPEDB_SCOPE": "support"
      }
    }
  }
}
```

### 4. Start Using

Once connected, the AI automatically gets these tools:

- **`db_describe`** — View table schemas visible to the current scope
- **`db_query`** — Structured queries (filters, sorting, JOINs, aggregation)
- **`db_mutate`** — Data mutations (only when scope includes write access)

Just ask in natural language:

```
"Show me the last 10 orders"
"Total order amounts by department"
"Change order #123 status to shipped"
```

## Configuration

### Database

```yaml
database:
  adapter: supabase            # Currently supports supabase
  url: ${SUPABASE_URL}         # Environment variable expansion supported
  key: ${SUPABASE_SERVICE_KEY}
```

### Table Definitions

```yaml
tables:
  table_name:
    description: "Table description (visible to AI)"
    columns:
      column_name:
        type: text              # uuid / text / integer / boolean / timestamp / jsonb
        description: "Column description"  # Optional, helps AI understand semantics
        references: other.id    # Optional, foreign key (enables JOINs)
    row_filter: "deleted_at IS NULL"  # Optional, table-level filter (shared by all scopes)
```

### Scope Definitions

Scopes are the core concept — defining precise data access boundaries for different roles.

```yaml
scopes:
  scope_name:
    description: "Role description"
    context_params: [current_user_id]  # Optional, runtime-injected parameters

    tables:
      table_name:
        access: read                    # read / write / [read, write]
        columns: [col1, col2]           # Visible columns (whitelist)
        writable_columns: [col1]        # Writable columns (write mode only)
        row_filter: "user_id = :current_user_id"  # Scope-level row filter

    settings:
      max_rows: 100           # Maximum rows returned
      max_joins: 2            # Maximum JOINs allowed
      allow_aggregate: true   # Whether aggregation queries are allowed
```

### Context Parameters

For multi-tenant scenarios — inject user identity at runtime:

```yaml
scopes:
  end_user:
    context_params: [current_user_id]
    tables:
      orders:
        access: read
        columns: [product, amount, status]
        row_filter: "user_id = :current_user_id"
```

Pass context at startup:

```bash
claude mcp add scopedb-user \
  -e SCOPEDB_CONTEXT='{"current_user_id":"user-uuid-here"}' \
  ...
```

### Global Settings

```yaml
settings:
  default_scope: support      # Default scope name
  max_rows: 200               # Global max rows (scope settings override)
  max_joins: 2                # Global max JOINs
  timeout_ms: 5000            # Query timeout (milliseconds)
  result_format: compact      # compact: cols+rows separated, saves tokens
  allow_aggregate: false      # Global aggregation toggle
  log: true                   # Query logging (to stderr)
```

## Programmatic Usage (Backend Integration)

Use ScopeDB as a library in your backend — no MCP protocol needed. Resolve a scope based on the user's role, convert tools to your AI provider's format, and let the AI call them in a loop.

```typescript
import {
  loadConfig, resolveScope, generateTools,
  handleDescribe, handleQuery, handleMutate,
  SupabaseAdapter,
} from "scopedb-mcp";

// 1. Load config & create adapter
const config = loadConfig("./scopedb.config.yaml");
const adapter = new SupabaseAdapter(config.database.url, config.database.key!);

// 2. Resolve scope based on user role (from JWT, session, etc.)
const scope = resolveScope(config, userRole); // "support" | "analytics" | "admin"

// 3. Generate tool definitions → convert to OpenAI function calling format
const tools = generateTools(scope).map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));

// 4. Call your AI provider (OpenRouter, OpenAI, etc.) with tools
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "anthropic/claude-sonnet-4", messages, tools }),
});

// 5. When AI returns tool_calls, execute via ScopeDB handlers
const ctx = { scope, adapter, log: true };
for (const tc of assistantMessage.tool_calls) {
  const args = JSON.parse(tc.function.arguments);
  // Permission guard + row filter injection happens automatically
  const result = await handleQuery(ctx, args);
  // Feed result back to AI...
}
```

**`scope` determines the permission boundary.** Different users get different scopes — permission checks, row filters, column visibility are all enforced automatically.

See [`examples/backend-openrouter.ts`](./examples/backend-openrouter.ts) for a complete working example.

ScopeDB can also run as a standalone MCP server:

```typescript
import { serve } from "scopedb-mcp";

await serve({ configPath: "./scopedb.config.yaml", scopeName: "analytics" });
```

## Development

```bash
pnpm install      # Install dependencies
pnpm build        # Build
pnpm test         # Run tests
pnpm typecheck    # Type check
pnpm dev          # Watch mode
```

## Project Structure

```
src/
├── config/          # Config loading & validation (YAML + Zod)
├── scope/           # Scope resolution & context parameter substitution
├── engine/          # Permission guard + query builder + result formatter
├── adapters/        # Database adapters (Supabase)
├── compiler/        # MCP tool definition generation + description compression
└── server/          # MCP Server (stdio transport)
```

## Roadmap

- [x] Supabase adapter
- [x] Structured queries + permission validation
- [x] Row-level filter injection
- [x] Aggregation (count / sum / avg / min / max / group_by)
- [x] MCP Server (stdio)
- [ ] HTTP transport
- [ ] CLI tools (init / serve / test / schema)
- [ ] Native Postgres adapter
- [ ] MySQL adapter
- [ ] Library mode (embedded AI conversations)

## Contributing

Contributions are welcome!

1. Fork this repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Ensure tests pass: `pnpm test && pnpm typecheck`
4. Submit a PR

## License

[MIT](LICENSE)
