/**
 * ScopeDB + OpenRouter 后端集成示例
 *
 * 演示如何在后端代码中：
 * 1. 根据用户角色选择不同 scope（权限隔离）
 * 2. 把 ScopeDB tools 转成 OpenAI function calling 格式
 * 3. 调用 OpenRouter API，自动处理 tool_calls 循环
 *
 * 用法：
 *   OPENROUTER_API_KEY=sk-xxx \
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=xxx \
 *   npx tsx examples/backend-openrouter.ts
 */

import {
  loadConfig,
  resolveScope,
  generateTools,
  handleDescribe,
  handleQuery,
  handleMutate,
  SupabaseAdapter,
} from "../src/index.js";
import type { ScopedConfig } from "../src/config/types.js";
import type { DBAdapter } from "../src/adapters/types.js";

// ─── 配置 ──────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MODEL = "anthropic/claude-sonnet-4"; // 或 openai/gpt-4o, google/gemini-2.0-flash 等

// ─── ScopeDB tools → OpenAI tools 格式转换 ───────────────

function toOpenAITools(
  scopeTools: ReturnType<typeof generateTools>,
): OpenAITool[] {
  return scopeTools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

// ─── Tool 执行器 ─────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { scope: ScopedConfig; adapter: DBAdapter; log: boolean },
): Promise<string> {
  let result;
  switch (name) {
    case "db_describe":
      result = handleDescribe(ctx, args as { table?: string });
      break;
    case "db_query":
      result = await handleQuery(ctx, args as any);
      break;
    case "db_mutate":
      result = await handleMutate(ctx, args as any);
      break;
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
  return result.content[0].text;
}

// ─── OpenRouter 聊天（带 tool_calls 循环）─────────────────

interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface Message {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

async function chat(
  userMessage: string,
  tools: OpenAITool[],
  ctx: { scope: ScopedConfig; adapter: DBAdapter; log: boolean },
): Promise<string> {
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a helpful data assistant. Use the provided database tools to answer questions. " +
        "Always call db_describe first if you're unsure about the schema. " +
        "Answer in the same language as the user's question.",
    },
    { role: "user", content: userMessage },
  ];

  const MAX_ROUNDS = 10;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 调用 OpenRouter
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    const assistantMsg = choice.message;

    // 把 assistant 消息加入历史
    messages.push(assistantMsg);

    // 如果没有 tool_calls，说明 AI 已经给出最终回答
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      return assistantMsg.content ?? "(no response)";
    }

    // 执行每个 tool_call，把结果喂回去
    for (const tc of assistantMsg.tool_calls) {
      const args = JSON.parse(tc.function.arguments);
      console.error(
        `[tool_call] ${tc.function.name}(${JSON.stringify(args)})`,
      );

      const result = await executeTool(tc.function.name, args, ctx);
      console.error(`[tool_result] ${result.substring(0, 200)}...`);

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  return "(max tool call rounds reached)";
}

// ─── 主流程 ─────────────────────────────────────────────

async function main() {
  // 1. 加载配置
  const config = loadConfig("./scopedb.config.yaml");

  // 2. 创建数据库适配器
  const adapter = new SupabaseAdapter(
    config.database.url,
    config.database.key!,
  );

  // 3. 模拟：根据用户角色选择 scope
  //    实际项目中，这里从 JWT / session / API key 判断角色
  const userRole = process.argv[2] || "support";
  const scope = resolveScope(config, userRole);

  console.log(`\n--- ScopeDB: scope="${userRole}" ---`);
  console.log(`可见表: ${Object.keys(scope.tables).join(", ")}`);
  console.log(`max_rows: ${scope.settings.max_rows}`);
  console.log();

  // 4. 生成 tools 并转换格式
  const scopeTools = generateTools(scope);
  const openaiTools = toOpenAITools(scopeTools);

  console.log(`注册工具: ${scopeTools.map((t) => t.name).join(", ")}`);
  console.log();

  // 5. Handler 上下文
  const ctx = { scope, adapter, log: true };

  // 6. 执行对话
  const question = process.argv[3] || "帮我查一下最近的订单";
  console.log(`用户: ${question}`);
  console.log();

  const answer = await chat(question, openaiTools, ctx);
  console.log(`AI: ${answer}`);
}

main().catch(console.error);
