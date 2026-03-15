<div align="center">

# ScopeDB MCP

**给 AI 数据库访问能力，而不是把整个数据库都交给它。**

一个基于配置的 MCP 服务器和 TypeScript 库，用来给 AI 提供有边界、可审计的数据访问能力。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-green.svg)](https://modelcontextprotocol.io/)

[English](./README.md) | [日本語](./README.ja.md)

</div>

---

ScopeDB 让 AI 自己获取需要的数据，但只能在你用 YAML 定义好的边界里活动：

```yaml
scopes:
  support:
    tables:
      users:  { access: read, columns: [name] }
      orders: { access: read, columns: [product, amount, status] }
    settings: { max_rows: 50, max_joins: 1 }
```

它更像是 AI 产品该有的默认方案：

- **不再手动组装上下文** — 不用每次模型调用前都手写一堆取数代码。
- **不暴露整库** — AI 只能看到被允许的表、列、行和操作。
- **不靠提示词拼裸 SQL** — 查询是结构化的，并且受 scope 规则约束。
- **需求变化时不用重写业务逻辑** — 改配置，不改应用代码。

## 为什么是 ScopeDB

| 方案 | 你得到什么 | 会出什么问题 |
|------|------------|--------------|
| 手动组装上下文 | 控制力很强 | 胶水代码很多、维护成本高，AI 无法自行追问和探索 |
| 裸 SQL / 全库访问 | 查询很灵活 | 安全风险高、token 浪费，还容易暴露敏感数据 |
| **ScopeDB** | AI 自主取数，同时访问有边界 | 你只需要定义一次边界，后续工具都会在边界内工作 |

## 实际体验是什么样

同一个应用里，你可以给不同 AI 工作流暴露不同的数据能力，而不用为每一种场景单独写查询代码：

| Scope | AI 可以做什么 | AI 不能做什么 |
|-------|----------------|----------------|
| `support` | 读取客户姓名和订单状态 | 查看邮箱、工资或内部备注 |
| `analytics` | 做 JOIN、聚合收入、比较趋势 | 读取分析视图之外的隐藏字段 |
| `admin` | 更新 `orders.status` 这类指定字段 | 随意写任意列，或修改所有表 |

例子：

> 用户问：“帮我看一下 Alice 最近一笔订单。”
>
> 在 `support` scope 下，AI 可以读取 `users.name` 和 `orders.status` 来回答。
>
> 如果它继续问“那 Alice 的工资是多少？”，ScopeDB 会直接拒绝，因为 `salary` 不在可见范围内。

## 你会得到什么

- **按表和列做可见性控制**，适合客服、分析工具、内部 Copilot 等场景
- **行级过滤能力**，适合多租户或按用户隔离的数据访问
- **可控的 JOIN 和聚合**，满足分析类 use case
- **只开放指定字段的写权限**，让 AI 做安全更新
- **两种接入方式**：独立 MCP 服务器，或直接集成进后端的 TypeScript 库

## 使用场景

| 场景 | 说明 |
|------|------|
| **后端 AI 功能** | AI 自主获取相关数据来生成回复 — 不用手动组装上下文，也不会暴露多余数据 |
| **客服 Agent** | 只能查看客户姓名和订单状态，看不到邮箱、工资或内部备注 |
| **数据分析** | 可以跨表 JOIN 和聚合，但看不到原价和内部备注 |
| **管理后台** | 拥有写入权限，但只能修改特定字段（如订单状态） |
| **多租户 SaaS** | 通过 `context_params` 注入 `user_id`，每个用户只能访问自己的数据 |
| **内部工具** | 用自然语言查询业务数据，无需编写 SQL |

## 边界是如何被强制执行的

<div align="center">

```
请求 → Scope 隔离 → Permission Guard → 结构化查询构建 → 行过滤注入 → 资源限制
```

</div>

1. **Scope 隔离** — 每个 scope 只能看到配置中声明的表和列
2. **Permission Guard** — 校验操作权限、列访问、操作符白名单
3. **结构化查询** — 禁止原始 SQL，所有参数经过验证后构建查询
4. **行过滤注入** — 表级 + scope 级 row_filter 自动合并注入
5. **资源限制** — max_rows / max_joins 防止过大查询

## 快速开始

### 1. 安装

```bash
pnpm install scopedb-mcp
# 或
npm install scopedb-mcp
```

### 2. 创建配置文件

创建 `scopedb.config.yaml`：

```yaml
version: 1

database:
  adapter: supabase
  url: ${SUPABASE_URL}
  key: ${SUPABASE_SERVICE_KEY}

tables:
  users:
    description: "用户信息"
    columns:
      id:    { type: uuid }
      name:  { type: text, description: "姓名" }
      email: { type: text, description: "邮箱" }
      salary: { type: integer, description: "年薪" }
    row_filter: "deleted_at IS NULL"

  orders:
    description: "订单数据"
    columns:
      id:       { type: uuid }
      user_id:  { type: uuid, references: users.id }
      product:  { type: text, description: "商品名" }
      amount:   { type: integer, description: "金额" }
      status:   { type: text, description: "pending / confirmed / shipped" }

scopes:
  support:
    description: "客服用 - 最小权限"
    tables:
      users:  { access: read, columns: [name] }
      orders: { access: read, columns: [product, amount, status] }
    settings:
      max_rows: 50
      max_joins: 1

  analytics:
    description: "分析用 - 可聚合，无敏感数据"
    tables:
      users:  { access: read, columns: [name] }
      orders: { access: read, columns: [user_id, product, amount, status] }
    settings:
      max_rows: 500
      max_joins: 3
      allow_aggregate: true

  admin:
    description: "管理员 - 写入权限"
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

### 3. 连接到 Claude Code

```bash
claude mcp add scopedb-support \
  -e SUPABASE_URL=https://xxx.supabase.co \
  -e SUPABASE_SERVICE_KEY=your-key \
  -e SCOPEDB_CONFIG=./scopedb.config.yaml \
  -e SCOPEDB_SCOPE=support \
  -- node /path/to/scopedb-mcp/dist/server/mcp.js
```

或者在 Claude Desktop 的配置文件中添加：

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

### 4. 开始使用

连接后，AI 会自动获得以下工具：

- **`db_describe`** — 查看当前 scope 可见的表结构
- **`db_query`** — 结构化查询（支持过滤、排序、JOIN、聚合）
- **`db_mutate`** — 数据写入（仅在 scope 包含 write 权限时可用）

直接用自然语言提问即可：

```
"帮我查一下最近 10 笔订单"
"按部门统计订单总金额"
"把订单 #123 的状态改为 shipped"
```

## 配置详解

### 数据库配置

```yaml
database:
  adapter: supabase          # 目前支持 supabase
  url: ${SUPABASE_URL}       # 支持环境变量展开
  key: ${SUPABASE_SERVICE_KEY}
```

### 表定义

```yaml
tables:
  table_name:
    description: "表的描述（AI 会看到）"
    columns:
      column_name:
        type: text             # uuid / text / integer / boolean / timestamp / jsonb
        description: "列描述"  # 可选，帮助 AI 理解语义
        references: other.id   # 可选，外键关系（用于 JOIN）
    row_filter: "deleted_at IS NULL"  # 可选，表级行过滤（所有 scope 共享）
```

### Scope 定义

Scope 是 ScopeDB 的核心概念 — 为不同角色定义精确的数据访问边界。

```yaml
scopes:
  scope_name:
    description: "角色描述"
    context_params: [current_user_id]  # 可选，运行时注入的参数

    tables:
      table_name:
        access: read                    # read / write / [read, write]
        columns: [col1, col2]           # 可见列（白名单）
        writable_columns: [col1]        # 可写列（仅 write 模式）
        row_filter: "user_id = :current_user_id"  # scope 级行过滤

    settings:
      max_rows: 100          # 最大返回行数
      max_joins: 2           # 最大 JOIN 数
      allow_aggregate: true  # 是否允许聚合查询
```

### Context Params（上下文参数）

用于多租户场景，运行时注入用户身份：

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

启动时传入上下文：

```bash
claude mcp add scopedb-user \
  -e SCOPEDB_CONTEXT='{"current_user_id":"user-uuid-here"}' \
  ...
```

### 全局设置

```yaml
settings:
  default_scope: support     # 默认 scope
  max_rows: 200              # 全局最大行数（scope 设置可覆盖）
  max_joins: 2               # 全局最大 JOIN 数
  timeout_ms: 5000           # 查询超时（毫秒）
  result_format: compact     # compact: 列+行分离，节省 token
  allow_aggregate: false     # 全局聚合开关
  log: true                  # 查询日志（输出到 stderr）
```

## 程序化使用（后端集成）

ScopeDB 可以作为库直接在后端使用 — 不需要走 MCP 协议。当 AI 调用和数据库在同一个进程中时，这是推荐的方式。

**核心思路：** 根据用户角色 resolve 一个 scope，把 tools 转成 AI 提供商的格式，让 AI 在循环中自己调用。

```typescript
import {
  loadConfig, resolveScope, generateTools,
  handleDescribe, handleQuery, handleMutate,
  SupabaseAdapter,
} from "scopedb-mcp";

// 1. 加载配置 & 创建适配器
const config = loadConfig("./scopedb.config.yaml");
const adapter = new SupabaseAdapter(config.database.url, config.database.key!);

// 2. 根据用户角色选择 scope（从 JWT / session / API key 判断）
const scope = resolveScope(config, userRole); // "support" | "analytics" | "admin"

// 3. 生成 tools → 转成 OpenAI function calling 格式
const tools = generateTools(scope).map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));

// 4. 调用 AI（OpenRouter、OpenAI 等），带上 tools
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "anthropic/claude-sonnet-4", messages, tools }),
});

// 5. AI 返回 tool_calls 时，通过 ScopeDB handlers 执行
const ctx = { scope, adapter, log: true };
for (const tc of assistantMessage.tool_calls) {
  const args = JSON.parse(tc.function.arguments);
  // 权限校验 + 行过滤注入自动发生
  const result = await handleQuery(ctx, args);
  // 把结果喂回 AI...
}
```

关键是 **`scope` 决定了权限边界**。不同用户拿到不同的 scope，后续整条链路 — 权限校验、行过滤、列可见性 — 全部自动执行。

完整的可运行示例见 [`examples/backend-openrouter.ts`](./examples/backend-openrouter.ts)。

ScopeDB 也可以作为独立的 MCP 服务器运行：

```typescript
import { serve } from "scopedb-mcp";

await serve({
  configPath: "./scopedb.config.yaml",
  scopeName: "analytics",
});
```

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 运行测试
pnpm test

# 类型检查
pnpm typecheck

# 开发模式（监听文件变化）
pnpm dev
```

## 项目结构

```
src/
├── config/          # 配置加载与验证（YAML + Zod）
├── scope/           # Scope 解析与上下文参数替换
├── engine/          # 权限校验 + 查询构建 + 结果格式化
├── adapters/        # 数据库适配器（Supabase）
├── compiler/        # MCP 工具定义生成 + 描述压缩
└── server/          # MCP Server（stdio transport）
```

## 路线图

- [x] Supabase 适配器
- [x] 结构化查询 + 权限校验
- [x] 行级过滤注入
- [x] 聚合查询（count / sum / avg / min / max / group_by）
- [x] MCP Server（stdio）
- [ ] HTTP transport
- [ ] CLI 工具（init / serve / test / schema）
- [ ] Postgres 原生适配器
- [ ] MySQL 适配器
- [ ] Library 模式（内嵌 AI 对话）

## 贡献

欢迎贡献！请阅读以下指南：

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 确保测试通过：`pnpm test && pnpm typecheck`
4. 提交 PR

## License

[MIT](LICENSE)
