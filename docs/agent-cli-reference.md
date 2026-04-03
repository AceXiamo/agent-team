# Agent CLI 接入参考

> 本文档描述 `agent-team` 如何接入本地 CLI Agent。
> 目标不是写“理论上可能的协议”，而是记录当前已经验证过的调用方式、stdout/stderr 结构、统一事件抽象，以及后续面板可展示的信息。

---

## 统一原则

### 接入边界

- app 层只依赖统一接口 `AgentDriver`
- 每个 CLI 的命令构造、stdout 解析、session 提取，都应在各自 driver 内完成
- 不要在 router 或 TUI 层写死某个 CLI 的协议细节

### 统一接口

```ts
interface AgentDriver {
  readonly name: 'claude' | 'codex' | 'kimi'
  readonly displayName: string

  send(opts: SendOptions): AsyncIterable<AgentEvent>
  abort(runId: string): Promise<void>
  isAvailable(): Promise<boolean>
}

interface SendOptions {
  prompt: string
  sessionId?: string
  workdir: string
  runId: string
}

type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: string }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string }
```

### Workspace 语义

- `agent-team` 的 workspace 就是启动进程时的当前目录
- driver 需要把 `workdir` 明确传给 CLI
- session 按 workspace 隔离，不能把不同目录的会话混用

---

## Claude Code

**二进制：** `claude`

### 调用方式

#### 新建

```bash
claude -p "<prompt>" --output-format stream-json --verbose
```

#### Resume

```bash
claude -p "<prompt>" --resume <sessionId> --output-format stream-json --verbose
```

### 已验证注意事项

- 当前环境里 `--output-format stream-json` 需要配合 `--verbose`
- 当前环境里 `--no-color` 不是通用可用 flag，不应默认加入
- `-p` 等价于 `--print`

### stdout JSONL 样式

```jsonc
// 普通文本
{
  "type": "assistant",
  "message": {
    "content": [
      { "type": "text", "text": "hey~ 👋 What can I help you with today?" }
    ]
  }
}

// 工具调用
{
  "type": "assistant",
  "message": {
    "content": [
      { "type": "tool_use", "name": "Read", "input": { "file_path": "..." } }
    ]
  }
}

// 工具结果
{
  "type": "tool_result",
  "tool_use_id": "toolu_xxx",
  "content": "..."
}

// 完成
{
  "type": "result",
  "subtype": "success",
  "session_id": "abc123"
}

// 失败
{
  "type": "result",
  "subtype": "error_during_execution",
  "error": "..."
}
```

### 统一映射

| Claude stdout 事件 | 统一 `AgentEvent` |
|---|---|
| `assistant.message.content[].type === "text"` | `text` |
| `assistant.message.content[].type === "tool_use"` | `tool_use` |
| `tool_result` | `tool_result` |
| `result.subtype === "success"` | `done(sessionId)` |
| `result.subtype` 为错误 | `error` |

### 可展示元信息

- `session_id`
- `usage`
- `cost_usd`
- 工具调用次数

建议：
- `usage` / `cost_usd` 可收敛到消息右侧 meta 区或详情面板
- 不必默认铺满主消息流

---

## Codex

**二进制：** `codex`

### 调用方式

#### 新建

```bash
codex exec "<prompt>" \
  --json \
  --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  -C <workdir>
```

#### Resume

```bash
codex exec resume <sessionId> "<prompt>" \
  --json \
  --dangerously-bypass-approvals-and-sandbox \
  -C <workdir>
```

### 为什么不用 `--full-auto`

- `--full-auto` 会让 Codex 再套一层自己的 `workspace-write` 沙盒
- `agent-team` 当前目标是把启动目录当作真实 workspace，并直接运行在宿主机环境
- 因此默认使用 `--dangerously-bypass-approvals-and-sandbox`

### 已验证的 live stdout 结构

当前版本 Codex 的 stdout 不是单一协议，而是混合事件流。已观察到的关键事件如下。

当前仓库里可直接对照的实现和样本：

- driver 解析逻辑：`src/drivers/codex.ts`
- live fixture：`test/fixtures/codex-live-sample.jsonl`
- 解析测试：`test/codex-fixture.test.ts`、`test/drivers.test.ts`

#### 最小成功样本

```json
{"type":"thread.started","thread_id":"019d5375-616a-72f2-90da-14050631cf4e"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hey. What do you need?"}}
{"type":"turn.completed","usage":{"input_tokens":14344,"cached_input_tokens":5504,"output_tokens":62}}
```

#### 另一类历史样本

```jsonc
{
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "assistant",
    "content": [
      { "type": "output_text", "text": "..." }
    ]
  }
}

{
  "type": "response_item",
  "payload": {
    "type": "function_call",
    "name": "shell_command",
    "arguments": "{\"command\":\"ls\"}",
    "call_id": "call_xxx"
  }
}

{
  "type": "response_item",
  "payload": {
    "type": "function_call_output",
    "call_id": "call_xxx",
    "output": "Exit code: 0\n..."
  }
}

{
  "type": "event_msg",
  "payload": {
    "type": "agent_reasoning",
    "text": "**Planning response**"
  }
}
```

### session 提取策略

Codex 当前不一定总是输出单独的 `done.session_id`。

当前策略：

- 优先取 `done.session_id`
- 如果没有 `done`，则回退取 `thread.started.thread_id`

这意味着：
- `thread_id` 应视为可 resume 的主会话标识
- `turn.completed` 是一次 turn 的结束，不是 session 的结束

### 统一映射

| Codex stdout 事件 | 统一 `AgentEvent` |
|---|---|
| `item.completed.item.type === "agent_message"` | `text` |
| `item.completed.item.type === "reasoning"` | `thinking` |
| `item.completed.item.type === "function_call"` | `tool_use` |
| `item.completed.item.type === "function_call_output"` | `tool_result` |
| `response_item.payload.type === "message"` 且 `role === "assistant"` | `text` |
| `response_item.payload.type === "function_call"` | `tool_use` |
| `response_item.payload.type === "function_call_output"` | `tool_result` |
| `event_msg.payload.type === "agent_message"` | `text` |
| `event_msg.payload.type === "agent_reasoning"` | `thinking` |
| `done.session_id` | `done(sessionId)` |
| `thread.started.thread_id` | `done(sessionId)` 的 session fallback |

### 当前 driver 已显式处理的顶层 `type`

下面这张表更接近“代码真实覆盖面”，方便后续补全时直接对照 `src/drivers/codex.ts`。

| 顶层 `type` | 当前处理方式 |
|---|---|
| `done` | 读取 `session_id/sessionId`，映射为 `done` |
| `thread.started` | 读取 `thread_id`，作为 session fallback 映射为 `done` |
| `item.completed` | 继续看 `item.type`，映射正文 / thinking / tool 事件 |
| `response_item` | 继续看 `payload.type`，映射正文 / tool 事件 |
| `event_msg` | 继续看 `payload.type`，映射 `agent_message` / `agent_reasoning` / `task_complete` |
| `turn.completed` | 提取 `usage`，映射为 `usage` |
| `turn.started` | 当前忽略 |
| `turn_context` | 当前忽略 |

### 当前已显式处理的子类型

| 容器 | 子类型 | 映射 |
|---|---|---|
| `item.completed.item.type` | `agent_message` | `text` |
| `item.completed.item.type` | `reasoning` | `thinking` |
| `item.completed.item.type` | `function_call` | `tool_use` |
| `item.completed.item.type` | `function_call_output` | `tool_result` |
| `response_item.payload.type` | `message` + `role=assistant` | `text` |
| `response_item.payload.type` | `function_call` | `tool_use` |
| `response_item.payload.type` | `function_call_output` | `tool_result` |
| `event_msg.payload.type` | `agent_message` | `text` |
| `event_msg.payload.type` | `agent_reasoning` | `thinking` |
| `event_msg.payload.type` | `task_complete` | 取 `last_agent_message` 映射 `text` |

补全策略建议：

- 先把真实 stdout 样本追加到 fixture，再补 `CodexDriver.mapLine()`。
- 新类型优先在 `test/drivers.test.ts` 或 fixture 测试里锁定，再改 driver。
- 不要在 router / TUI 层猜协议，Codex 差异统一收口到 driver。

### `turn.completed.usage` 的产品价值

Codex 的 `turn.completed` 已经带了较有价值的统计信息：

```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 14344,
    "cached_input_tokens": 5504,
    "output_tokens": 62
  }
}
```

这些字段很适合后续挂到面板：

- `input_tokens`
- `cached_input_tokens`
- `output_tokens`

可派生指标：

- 本次 turn 总 token = `input_tokens + output_tokens`
- cache 命中比例 = `cached_input_tokens / input_tokens`

建议展示位置：

- 消息详情抽屉
- Agent 状态面板
- 每条回复右上角的小型 usage badge

当前阶段建议：
- 先在 driver 层保留这类元事件的原始信息
- 等 UI 方案定了，再决定是否扩展统一 `AgentEvent`

### stderr 的处理建议

Codex stderr 经常混入：

- plugin sync warning
- shell snapshot warning
- Cloudflare/403 页面片段

这些信息不应直接判定为“本次对话失败”。

应对原则：

- stderr 默认归为 `thinking` 或系统噪音
- 真正失败以“无有效 stdout 且进程退出”或明确错误事件为准
- 类似 `shell_snapshot` 清理 warning 一般只是收尾噪音，不是主因

---

## Kimi

**二进制：** `kimi`

### 调用方式

#### 新建

```bash
kimi --print "<prompt>" --output-format stream-json --work-dir <workdir>
```

#### Resume

```bash
kimi --print "<prompt>" --resume <sessionId> --output-format stream-json --work-dir <workdir>
```

### stdout JSONL

Kimi 当前按 Claude 风格处理，主要对齐：

- `assistant`
- `tool_result`
- `result.session_id`

### 统一映射

| Kimi stdout 事件 | 统一 `AgentEvent` |
|---|---|
| `assistant.message.content[].text` | `text` |
| `assistant.message.content[].tool_use` | `tool_use` |
| `tool_result` | `tool_result` |
| `result.session_id` | `done(sessionId)` |

---

## 面板扩展建议

下面这些字段后续都值得纳入 UI，而不是只显示正文。

### Claude Code

- `session_id`
- `usage`
- `cost_usd`
- 工具调用明细

### Codex

- `thread_id`
- `turn.completed.usage.input_tokens`
- `turn.completed.usage.cached_input_tokens`
- `turn.completed.usage.output_tokens`
- 工具调用 / 输出

### 通用展示建议

- 主消息流默认只展示正文与简短工具摘要
- token / cost / usage 放在折叠详情或右侧 meta
- session/thread id 不默认暴露给普通用户，但应在 debug 面板可见

---

## 当前结论

- Claude Code 协议相对稳定，重点是命令参数兼容性
- Codex 事件流版本差异更大，driver 必须按真实 live 输出持续修正
- 后续如果新增 Agent，不应扩展 router 特判，而应在该 Agent 的 driver 内完成协议适配
- token / usage / cost 属于一等元数据，后续完全值得挂到面板上
