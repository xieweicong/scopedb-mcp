# ScopeDB MCP

**AI に安全なデータベースアクセスを — 設定ドリブンの権限分離 MCP サーバー & ライブラリ**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-green.svg)](https://modelcontextprotocol.io/)

> 🌐 [中文](./README.zh.md) | [English](./README.md)

---

## 課題

AI 機能を構築する際、AI は意味のある応答を生成するためにデータベースからデータを取得する必要があります。現在、一般的なアプローチは2つありますが、どちらにも深刻な欠点があります：

**アプローチ1：手動コンテキスト組み立て**
特定のデータを取得するコードを書いて、コンテキストを組み立てて AI に渡します。動作しますが柔軟性がありません — AI が異なるデータを必要とするたびに、バックエンドコードを修正する必要があります。AI 自身がフォローアップの質問をしたり、関連データを探索することができません。

```typescript
// AI が何を必要とするか事前に予測しなければならない...
const user = await db.query("SELECT name, plan FROM users WHERE id = ?", [userId]);
const orders = await db.query("SELECT * FROM orders WHERE user_id = ?", [userId]);

const response = await ai.chat({
  messages: [{ role: "user", content: `この顧客を要約して: ${JSON.stringify({ user, orders })}` }],
});
// もし AI が商品詳細も必要なら？コードを変更する必要があります。
```

**アプローチ2：AI にフルデータベースアクセスを付与（生 SQL や既存の MCP サーバー）**
AI は必要なものを何でもクエリできますが、すべてが見えてしまいます：給与、社内メモ、原価、他のユーザーのデータ。これは**セキュリティリスク**と**コンテキスト汚染**（無関係なデータがトークンを浪費し、AI の判断を混乱させる）を引き起こします。

## 解決策

ScopeDB は異なるアプローチを取ります：**AI が必要なデータを自律的に取得できるようにしつつ、あなたが定義した境界内でのみ動作させます。**

1つの YAML 設定で、AI がアクセスできるテーブル、カラム、行を宣言します。AI はデータベースツールを受け取り、何をクエリするか自分で判断しますが、scope の外にあるものは物理的に見ることも操作することもできません。

```yaml
# 「この AI 機能は注文ステータスと商品名のみ読み取り可能。
#  給与は不可、社内メモは不可、他のユーザーのデータも不可。」
scopes:
  order_assistant:
    tables:
      orders:  { access: read, columns: [product, amount, status] }
      products: { access: read, columns: [name, price, category] }
    settings: { max_rows: 50 }
```

- **手動コンテキスト組み立て不要** — AI が必要なデータを自分でクエリ
- **データ漏洩なし** — 明示的に許可したものだけが見える
- **生 SQL なし** — すべてのクエリは構造化検証済み、5層のセキュリティ検証
- **コード変更不要** — 要件が変わったら YAML 設定を調整するだけ

## ユースケース

| シナリオ | 説明 |
|----------|------|
| **バックエンド AI 機能** | AI が関連するユーザーデータを自律的に取得して応答を生成 — 手動コンテキスト組み立て不要、不要なテーブルも非公開 |
| **カスタマーサポート Agent** | 顧客名と注文ステータスのみ閲覧可能 — メール・給与・社内メモは非表示 |
| **データ分析** | テーブル間 JOIN と集計が可能だが、原価と社内メモは非表示 |
| **管理画面** | 書き込み権限あり、ただし特定カラムのみ（例：注文ステータス） |
| **マルチテナント SaaS** | `context_params` で `user_id` を注入し、各ユーザーは自分のデータのみアクセス |
| **社内ツール** | 自然言語でビジネスデータを照会 — SQL 不要 |

## セキュリティモデル

```
リクエスト → Scope 分離 → Permission Guard → 構造化クエリ構築 → 行フィルタ注入 → リソース制限
```

1. **Scope 分離** — 各 scope は設定で宣言されたテーブルとカラムのみ参照可能
2. **Permission Guard** — アクセスモード・カラムアクセス・演算子ホワイトリストの検証
3. **構造化クエリ** — 生 SQL 禁止、すべてのパラメータは検証後にクエリ構築
4. **行フィルタ注入** — テーブルレベル + scope レベルの row_filter を自動マージ・注入
5. **リソース制限** — max_rows / max_joins で過大なクエリを防止

## クイックスタート

### 1. インストール

```bash
pnpm install scopedb-mcp
# または
npm install scopedb-mcp
```

### 2. 設定ファイルの作成

`scopedb.config.yaml` を作成：

```yaml
version: 1

database:
  adapter: supabase
  url: ${SUPABASE_URL}
  key: ${SUPABASE_SERVICE_KEY}

tables:
  users:
    description: "社員情報"
    columns:
      id:     { type: uuid }
      name:   { type: text, description: "氏名" }
      email:  { type: text, description: "メールアドレス" }
      salary: { type: integer, description: "年収" }
    row_filter: "deleted_at IS NULL"

  orders:
    description: "受注データ"
    columns:
      id:       { type: uuid }
      user_id:  { type: uuid, references: users.id }
      product:  { type: text, description: "商品名" }
      amount:   { type: integer, description: "金額" }
      status:   { type: text, description: "pending / confirmed / shipped" }

scopes:
  support:
    description: "カスタマーサポート用 — 最小権限"
    tables:
      users:  { access: read, columns: [name] }
      orders: { access: read, columns: [product, amount, status] }
    settings:
      max_rows: 50
      max_joins: 1

  analytics:
    description: "分析用 — 集計可能、機密データ非表示"
    tables:
      users:  { access: read, columns: [name] }
      orders: { access: read, columns: [user_id, product, amount, status] }
    settings:
      max_rows: 500
      max_joins: 3
      allow_aggregate: true

  admin:
    description: "管理者 — 特定カラムへの書き込み権限"
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

### 3. Claude Code に接続

```bash
claude mcp add scopedb-support \
  -e SUPABASE_URL=https://xxx.supabase.co \
  -e SUPABASE_SERVICE_KEY=your-key \
  -e ASKDB_CONFIG=./scopedb.config.yaml \
  -e ASKDB_SCOPE=support \
  -- node /path/to/scopedb-mcp/dist/server/mcp.js
```

または Claude Desktop の設定ファイルに追加：

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

### 4. 使い始める

接続後、AI は以下のツールを自動的に取得します：

- **`db_describe`** — 現在の scope で参照可能なテーブル構造を表示
- **`db_query`** — 構造化クエリ（フィルタ、ソート、JOIN、集計）
- **`db_mutate`** — データ変更（scope に write 権限がある場合のみ）

自然言語で質問するだけです：

```
「最近の注文10件を見せて」
「部署別の注文合計金額を集計して」
「注文 #123 のステータスを shipped に変更して」
```

## 設定の詳細

### データベース設定

```yaml
database:
  adapter: supabase              # 現在 supabase をサポート
  url: ${SUPABASE_URL}           # 環境変数の展開をサポート
  key: ${SUPABASE_SERVICE_KEY}
```

### テーブル定義

```yaml
tables:
  table_name:
    description: "テーブルの説明（AI に表示される）"
    columns:
      column_name:
        type: text                # uuid / text / integer / boolean / timestamp / jsonb
        description: "カラムの説明"  # オプション、AI のセマンティック理解を支援
        references: other.id      # オプション、外部キー関係（JOIN に使用）
    row_filter: "deleted_at IS NULL"  # オプション、テーブルレベルフィルタ（全 scope 共有）
```

### Scope 定義

Scope は ScopeDB の中核コンセプトです — ロールごとに精密なデータアクセス境界を定義します。

```yaml
scopes:
  scope_name:
    description: "ロールの説明"
    context_params: [current_user_id]  # オプション、実行時に注入されるパラメータ

    tables:
      table_name:
        access: read                    # read / write / [read, write]
        columns: [col1, col2]           # 参照可能なカラム（ホワイトリスト）
        writable_columns: [col1]        # 書き込み可能なカラム（write モードのみ）
        row_filter: "user_id = :current_user_id"  # scope レベル行フィルタ

    settings:
      max_rows: 100           # 最大返却行数
      max_joins: 2            # 最大 JOIN 数
      allow_aggregate: true   # 集計クエリの許可
```

### Context Params（コンテキストパラメータ）

マルチテナントシナリオ向け — 実行時にユーザー ID を注入：

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

起動時にコンテキストを渡す：

```bash
claude mcp add scopedb-user \
  -e ASKDB_CONTEXT='{"current_user_id":"user-uuid-here"}' \
  ...
```

### グローバル設定

```yaml
settings:
  default_scope: support      # デフォルト scope
  max_rows: 200               # グローバル最大行数（scope 設定で上書き可能）
  max_joins: 2                # グローバル最大 JOIN 数
  timeout_ms: 5000            # クエリタイムアウト（ミリ秒）
  result_format: compact      # compact: カラム+行分離、トークン節約
  allow_aggregate: false      # グローバル集計トグル
  log: true                   # クエリログ（stderr に出力）
```

## プログラムでの使用（バックエンド統合）

ScopeDB はバックエンドでライブラリとして直接使用できます — MCP プロトコル不要。AI 呼び出しとデータベースが同一プロセス内にある場合、こちらが推奨アプローチです。

**基本的な考え方：** ユーザーのロールに基づいて scope を resolve し、tools を AI プロバイダーのフォーマットに変換し、AI がループ内でそれらを呼び出せるようにします。

```typescript
import {
  loadConfig, resolveScope, generateTools,
  handleDescribe, handleQuery, handleMutate,
  SupabaseAdapter,
} from "scopedb-mcp";

// 1. 設定読み込み & アダプタ作成
const config = loadConfig("./scopedb.config.yaml");
const adapter = new SupabaseAdapter(config.database.url, config.database.key!);

// 2. ユーザーロールに基づいて scope を選択（JWT / session / API key から判断）
const scope = resolveScope(config, userRole); // "support" | "analytics" | "admin"

// 3. ツール定義を生成 → OpenAI function calling フォーマットに変換
const tools = generateTools(scope).map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));

// 4. AI プロバイダー（OpenRouter、OpenAI など）を tools 付きで呼び出し
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "anthropic/claude-sonnet-4", messages, tools }),
});

// 5. AI が tool_calls を返したら、ScopeDB handlers で実行
const ctx = { scope, adapter, log: true };
for (const tc of assistantMessage.tool_calls) {
  const args = JSON.parse(tc.function.arguments);
  // 権限ガード + 行フィルタ注入が自動的に実行される
  const result = await handleQuery(ctx, args);
  // 結果を AI にフィードバック...
}
```

重要なのは **`scope` が権限境界を決定する**ことです。異なるユーザーには異なる scope が割り当てられ、後続のパイプライン全体 — 権限チェック、行フィルタ、カラムの可視性 — がすべて自動的に適用されます。

完全な動作サンプルは [`examples/backend-openrouter.ts`](./examples/backend-openrouter.ts) を参照してください。

ScopeDB はスタンドアロンの MCP サーバーとしても実行可能です：

```typescript
import { serve } from "scopedb-mcp";

await serve({
  configPath: "./scopedb.config.yaml",
  scopeName: "analytics",
});
```

## 開発

```bash
pnpm install      # 依存関係のインストール
pnpm build        # ビルド
pnpm test         # テスト実行
pnpm typecheck    # 型チェック
pnpm dev          # ウォッチモード
```

## プロジェクト構成

```
src/
├── config/          # 設定の読み込みとバリデーション（YAML + Zod）
├── scope/           # Scope 解決とコンテキストパラメータ置換
├── engine/          # 権限ガード + クエリビルダー + 結果フォーマッタ
├── adapters/        # データベースアダプタ（Supabase）
├── compiler/        # MCP ツール定義生成 + 説明文圧縮
└── server/          # MCP Server（stdio transport）
```

## ロードマップ

- [x] Supabase アダプタ
- [x] 構造化クエリ + 権限検証
- [x] 行レベルフィルタ注入
- [x] 集計クエリ（count / sum / avg / min / max / group_by）
- [x] MCP Server（stdio）
- [ ] HTTP transport
- [ ] CLI ツール（init / serve / test / schema）
- [ ] Postgres ネイティブアダプタ
- [ ] MySQL アダプタ
- [ ] Library モード（組み込み AI 対話）

## コントリビュート

コントリビューション大歓迎です！

1. このリポジトリを Fork
2. 機能ブランチを作成：`git checkout -b feature/your-feature`
3. テストが通ることを確認：`pnpm test && pnpm typecheck`
4. PR を提出

## License

[MIT](LICENSE)
