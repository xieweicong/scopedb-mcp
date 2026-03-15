# ScopeDB MCP

**Let AI access your database safely — a config-driven, permission-isolated MCP server & library**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-green.svg)](https://modelcontextprotocol.io/)

> 🌐 [中文](./README.zh.md) | [日本語](./README.ja.md)

---

## The Problem

When building AI-powered features, your AI often needs data from the database to generate meaningful responses. Today there are two common approaches — both have serious drawbacks:

**Approach 1: Manual context assembly**
You write code to fetch specific data, assemble it into context, and send it to the AI. This works, but it's rigid — every time the AI needs different data, you have to modify your backend code. The AI can't ask follow-up questions or explore related data on its own.

```typescript
// You have to anticipate exactly what the AI needs...
const user = await db.query("SELECT name, plan FROM users WHERE id = ?", [userId]);
const orders = await db.query("SELECT * FROM orders WHERE user_id = ?", [userId]);

const response = await ai.chat({
  messages: [{ role: "user", content: `Summarize this customer: ${JSON.stringify({ user, orders })}` }],
});
// What if the AI also needs product details? You have to change your code.
```

**Approach 2: Give AI full database access (raw SQL or existing MCP servers)**
The AI can query anything it needs — but it can also see everything: salaries, internal notes, cost prices, other users' data. This creates **security risks** and **context pollution** (irrelevant data wastes tokens and confuses the AI).

## The Solution

ScopeDB takes a different approach: **let the AI fetch the data it needs autonomously, but only within boundaries you define.**

With a single YAML config, you declare exactly which tables, columns, and rows the AI can access. The AI gets database tools and decides what to query on its own — but it physically cannot see or touch anything outside its scope.

```yaml
# "For this AI feature, it can read order status and product names,
#  but NOT salaries, NOT internal notes, NOT other users' data."
scopes:
  order_assistant:
    tables:
      orders:  { access: read, columns: [product, amount, status] }
      products: { access: read, columns: [name, price, category] }
    settings: { max_rows: 50 }
```

- **No manual context assembly** — the AI queries what it needs
- **No data leakage** — it only sees what you explicitly allow
- **No raw SQL** — all queries are structured and validated through 5 security layers
- **No code changes** — adjust the YAML config when requirements change

## Use Cases

| Scenario | Description |
|----------|-------------|
| **Backend AI Features** | Let AI autonomously fetch relevant user data to generate responses — without manually assembling context or exposing unnecessary tables |
| **Support Agent** | Can only see customer names and order status — no emails, salaries, or internal notes |
| **Data Analytics** | Cross-table JOINs and aggregation allowed, but cost prices and internal notes hidden |
| **Admin Dashboard** | Write access granted, but only to specific columns (e.g., order status) |
| **Multi-tenant SaaS** | Inject `user_id` via `context_params` so each user only sees their own data |
| **Internal Tools** | Query business data with natural language — no SQL required |

## Security Model

```
Request → Scope Isolation → Permission Guard → Structured Query Builder → Row Filter Injection → Resource Limits
```

1. **Scope Isolation** — each scope only sees tables and columns declared in config
2. **Permission Guard** — validates access mode, column access, operator whitelist
3. **Structured Queries** — no raw SQL; all parameters are validated before query construction
4. **Row Filter Injection** — table-level + scope-level row_filters are automatically merged and injected
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
  -e ASKDB_CONFIG=./scopedb.config.yaml \
  -e ASKDB_SCOPE=support \
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
        "ASKDB_CONFIG": "./scopedb.config.yaml",
        "ASKDB_SCOPE": "support"
      }
    }
  }
}
```

### 4. Start Using

Once connected, the AI automatically gets these tools:

- **`db_describe`** — View table schemas visible to the current scope
- **`db_query`** — Structured queries (filters, sorting, JOINs, aggregation)
- **`db_mutate`** — Data mutations (only available when scope includes write access)

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
  -e ASKDB_CONTEXT='{"current_user_id":"user-uuid-here"}' \
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

ScopeDB can be used as a library in your backend — no MCP protocol needed. This is the recommended approach when your AI calls and database live in the same process.

**Core idea:** resolve a scope based on the user's role, convert tools to your AI provider's format, and let the AI call them in a loop.

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

The key is that **`scope` determines the permission boundary**. Different users get different scopes, and the entire downstream pipeline — permission checks, row filters, column visibility — is automatically enforced.

See [`examples/backend-openrouter.ts`](./examples/backend-openrouter.ts) for a complete working example with tool_calls loop.

ScopeDB can also run as a standalone MCP server:

```typescript
import { serve } from "scopedb-mcp";

await serve({
  configPath: "./scopedb.config.yaml",
  scopeName: "analytics",
});
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
