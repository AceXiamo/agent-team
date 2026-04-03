# agent-team — Technical Spec

> 一个 IM 风格的 CLI 应用，让多个本地 AI Agent 融入开发工作流，支持人机协作与 Agent 间任务委派。

---

## 项目概述

### 背景

现有的 AI coding 工具（Codex、Claude Code、Kimi CLI、Copilot CLI 等）各自独立运行，协作时人需要手动在工具间 relay 信息——复制输出、粘贴输入、做中转。这不是真正的委派，而是人扮演了消息总线。

`agent-team` 的目标是把这个过程自动化：提供一个类 IM 的对话界面，让你像在群聊里 @ 人一样指派任务给 Agent，Agent 之间也可以互相协作，你只在两端：**下命令 + 看结果**。

### 核心交互模型

```
你（Human）
 ├─ @Claude  → 驱动本地 Claude Code 进程
 ├─ @Codex   → 驱动本地 Codex 进程
 ├─ @Kimi    → 驱动本地 Kimi CLI 进程
 └─ @Copilot → 驱动本地 Copilot CLI 进程

典型工作流：
1. 你 → @Codex: "看一下 src/ 的代码，和 @Claude 讨论一下，给我一份重构方案"
2. Codex 分析代码，生成任务描述，通过 app 转发给 Claude
3. Claude 返回方案，Codex 汇总，推送到界面
4. 你 review → @Codex: "方案没问题，让 Claude 开始实现"
5. 实现完成，结果汇报给你
```

人只在开始和结束介入，中间过程 Agent 自治。

### 默认协作心智

- 你首先点名的 Agent 是本轮任务的主 Agent（owner）
- 主 Agent 可以继续委派，但不能只做消息转发
- 只要发生过委派，主 Agent 默认需要 review / synthesize 子 Agent 的结果
- 子 Agent 的产出默认先回到主 Agent，由主 Agent 决定是否继续返工或向你汇报
- 最终面向你的结果，默认应当由主 Agent 统一交付

---

## 核心设计理念

**1. Agent 自管上下文**
不在 app 层维护对话历史。每个 Agent 进程通过自身的 session 机制持久化上下文，app 只需存储 `sessionId`，resume 时透传即可。上下文压缩、summarization 全部由 Agent 自身处理，对 app 透明。

**2. App 是消息总线**
所有消息（包括 Agent 间通信）都经过 app 路由。Agent 不直接互相调用，而是通过 app 转发——这样你随时可以看到完整的消息流，也可以在任意节点介入或中断。

**3. 模块化 Agent 接入层**
每个 Agent 是一个独立的 Driver 实现，遵循统一接口。新增 Agent 只需实现接口，不改动上层逻辑。当前支持 4 个，后续（如 Cursor Agent 等待官方 headless API 支持）可以直接插入。

**4. IM 优先的交互范式**
界面设计对标 IM 应用：消息流 + @ mention + 发送者标签。不做复杂的命令系统，自然语言就是指令。

---

## Agent 接入层

### 统一 Driver 接口

```typescript
interface AgentDriver {
  readonly name: string        // "claude" | "codex" | "kimi" | "copilot"
  readonly displayName: string // "Claude Code" | "Codex" | "Kimi" | "Copilot CLI"

  /**
   * 发起一次对话（新建 session 或 resume）
   * 返回 AsyncIterable，流式 yield 消息事件
   */
  send(opts: SendOptions): AsyncIterable<AgentEvent>

  /**
   * 中断当前执行
   */
  abort(sessionId: string): Promise<void>

  /**
   * 检查本地 CLI 是否可用
   */
  isAvailable(): Promise<boolean>
}

interface SendOptions {
  prompt: string
  sessionId?: string   // 有则 resume，无则新建
  workdir: string
}

type AgentEvent =
  | { type: 'text';       content: string }
  | { type: 'thinking';   content: string }
  | { type: 'tool_use';   tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: string }
  | { type: 'done';       sessionId: string }
  | { type: 'error';      message: string }
```

### 四个 Driver 实现

#### ClaudeDriver

```bash
# 新建 session
claude -p "<prompt>" --output-format stream-json --verbose --dangerously-skip-permissions

# Resume session
claude -p "<prompt>" --resume <sessionId> --output-format stream-json --verbose --dangerously-skip-permissions
```

- 输出格式：JSONL stream，每行一个事件
- Session ID：从 `done` 事件的 output JSON 中取 `session_id` 字段
- 上下文压缩：内置 4 层 compaction，自动触发，对 driver 透明

#### CodexDriver

```bash
# 新建 session
codex exec "<prompt>" --json --full-auto

#### CopilotDriver

```bash
# 新建 session
copilot --prompt "<prompt>" --output-format json --allow-all --stream off --no-color

# Resume session
copilot --prompt "<prompt>" --output-format json --allow-all --stream off --no-color --resume=<sessionId>
```

- 输出格式：JSONL stream，每行一个事件
- Session ID：从最终 `result.sessionId` 提取
- 已验证事件：`assistant.message`、`assistant.reasoning`、`tool.execution_start`、`tool.execution_complete`、`result`

# Resume session
codex resume <sessionId> --json
```

- 输出格式：JSONL stream
- Session 存储：`~/.codex/sessions/YYYY/MM/DD/*.jsonl`
- 上下文压缩：自动 summarization，对 driver 透明

#### KimiDriver

```bash
# 新建 session
kimi --print "<prompt>" --output-format stream-json

# Resume session
kimi --print "<prompt>" --resume <sessionId> --output-format stream-json
```

- 输出格式：JSONL stream（与 Claude Code 格式对齐）
- Session resume：`--resume <id>` 或 `-r <id>`

### 扩展新 Agent

实现 `AgentDriver` 接口，注册到 `DriverRegistry` 即可：

```typescript
// drivers/index.ts
export const registry = new DriverRegistry([
  new ClaudeDriver(),
  new CodexDriver(),
  new KimiDriver(),
  // new CursorDriver(),  // 等待 headless API 支持
])
```

上层 TUI 和消息路由完全不需要修改。

---

## TUI 架构

### 技术栈

- **框架**：[Ink](https://github.com/vadimdemedes/ink) — React for CLI，Claude Code 本身也用 Ink
- **语言**：TypeScript + TSX
- **布局**：Yoga Flexbox（Ink 内置）
- **运行时**：Node.js（通过 `tsx` 直接运行 `.ts` 文件）

### 界面结构

```
┌─────────────────────────────────────────────┐
│  agent-team  •  /path/to/workspace          │  ← Header
├─────────────────────────────────────────────┤
│                                             │
│  [You]  12:01                               │  │
│  @Claude 看一下 src/，给个重构建议           │  │
│                                             │  │
│  [Claude Code]  12:01                       │  Message
│  好的，我来分析一下代码结构...               │  Stream
│  ✦ Reading src/index.ts                     │  (scrollable)
│  ✦ Reading src/components/...              │  │
│  重构建议如下：...                           │  │
│                                             │  │
│  [Codex]  12:03                             │  │
│  → Claude 我看完了，你觉得这里的设计...      │  ↓
│                                             │
├─────────────────────────────────────────────┤
│  > _                                        │  ← Input Box
└─────────────────────────────────────────────┘
```

### 组件树

```
<App>
 ├─ <Header />              工作区路径、已连接的 Agent 状态
 ├─ <MessageStream />       消息列表，自动滚动到底部
 │   └─ <MessageBubble />   单条消息，含发送者、时间、内容
 │       ├─ <TextContent /> 普通文本，支持 markdown 基础渲染
 │       └─ <ToolEvent />   工具调用展示（折叠/展开）
 └─ <InputBox />            输入框，支持 @mention 补全
```

### 消息路由逻辑

```
InputBox 解析用户输入
  ↓
MessageRouter.route(message)
  ├─ 解析 @mention，确定目标 Agent
  ├─ 注入 Agent 间通信上下文（如 "来自 Codex 的消息：..."）
  └─ 调用对应 Driver.send()
       ↓
     AgentEvent stream
       ↓
     MessageStore.append()  →  触发 React re-render  →  MessageStream 更新
```

---

## 数据模型

### 核心状态

```typescript
// 一条消息
interface Message {
  id: string
  sender: 'human' | AgentName   // 'human' | 'claude' | 'codex' | 'kimi' | 'copilot'
  content: MessageContent[]
  timestamp: Date
  status: 'streaming' | 'done' | 'error'
}

type MessageContent =
  | { type: 'text';      text: string }
  | { type: 'tool_use';  tool: string; input: unknown; collapsed: boolean }

// 每个 Agent 的运行时状态
interface AgentState {
  name: AgentName
  sessionId: string | null   // null = 尚未建立 session
  status: 'idle' | 'running' | 'error'
  available: boolean          // CLI 是否安装可用
}

// 全局应用状态
interface AppState {
  messages: Message[]
  agents: Record<AgentName, AgentState>
  workdir: string
}
```

### Session 持久化

Session ID 存储在本地 `~/.agent-team/sessions.json`，格式：

```json
{
  "workdir_hash": {
    "claude": "sess_abc123",
    "codex":  "rollout-2026-04-03T...",
    "kimi":   "kimi_sess_xyz",
    "copilot": "495c98c2-ff5c-4d93-a8d9-bd961c1cd458"
  }
}
```

按 workdir 区分，不同项目的 session 互相隔离。启动时自动 resume 上次的 session，也可以通过 `/reset @Claude` 命令清除。

---

## 关键技术问题备忘

| 问题 | 结论 |
|------|------|
| Agent 上下文谁维护？ | Agent CLI 自身，app 只存 sessionId |
| Context 满了怎么办？ | 三个工具均内置自动压缩，对 app 透明 |
| Agent 间通信怎么实现？ | app 作为总线，把 Agent A 的输出包装成 prompt 转发给 Agent B |
| Cursor Agent 支持？ | 暂不支持，等官方提供 headless API，届时实现 `CursorDriver` 接入 |
| 流式输出渲染？ | Ink 的 `useState` + stream 事件驱动 re-render，逐字追加 |
| 工具调用展示？ | 默认折叠，`✦ Reading xxx` 摘要，可展开看完整 input/output |
