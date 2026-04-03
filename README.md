# agent-team

IM 风格的终端应用，让 Claude Code、Codex、Kimi CLI 三个本地 AI Agent 在一个对话界面里协同工作。你像在群聊里 @ 人一样指派任务，Agent 之间可以互相委派，你只需要下命令和看结果。

```
你（Human）
 ├─ @Claude  → 驱动本地 Claude Code
 ├─ @Codex   → 驱动本地 Codex CLI
 └─ @Kimi    → 驱动本地 Kimi CLI
```

## 为什么做这个

现有的 AI coding 工具各自独立运行。协作时你需要手动在工具间复制粘贴、做人肉消息中转。agent-team 把这个过程自动化：你在一个终端里同时调度多个 Agent，它们可以互相协作，你只在两端介入。

## 快速开始

### 前置条件

- Node.js >= 24
- 至少安装以下 CLI 之一：[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex](https://github.com/openai/codex)、[Kimi CLI](https://github.com/anthropics/kimi)

### 安装与运行

```bash
git clone <repo-url> && cd agent-team
npm install
npm run dev
```

启动后自动检测本地可用的 Agent CLI，在 Header 面板显示在线状态。

### 构建

```bash
npm run build
npm start
```

## 使用

### 发送消息

每条消息需要包含一个 `@Agent` mention 来指定目标：

```
@Codex 看一下 src/ 目录结构，给个重构建议
@Claude 帮我写一个 utils/logger.ts
@Kimi review 一下最近的改动
```

### Agent 间委派

Agent 可以在回复中自动委派任务给其他 Agent。典型流程：

1. 你 → `@Codex`: "分析 src/，和 @Claude 讨论重构方案"
2. Codex 分析代码，委派给 Claude
3. Claude 返回方案，Codex review 后汇总给你
4. 你 review → `@Codex`: "方案没问题，让 Claude 开始实现"

主 Agent 会自动 review 子 Agent 的产出，最终统一交付给你。

### 命令

| 命令 | 说明 |
|------|------|
| `/new [title]` | 创建新 session |
| `/sessions` | 列出当前工作区所有 session |
| `/switch <id>` | 切换到指定 session |
| `/reset @Agent` | 重置某个 Agent 的 session |
| `/agent @Agent on\|off` | 启用 / 禁用某个 Agent |

### 快捷键

| 按键 | 说明 |
|------|------|
| `↑` / `↓` | 在消息列表中导航 |
| `Ctrl+P` / `Ctrl+N` | 同上 |
| `Ctrl+L` | 跳到最新消息 |
| `Enter` | 发送消息 / 展开折叠的 tool 块 |
| `Tab` | @mention 补全 |
| `Esc` | 清空输入 |
| `←` / `→` | 移动光标 |
| `Ctrl+A` / `Ctrl+E` | 行首 / 行尾 |
| `Ctrl+U` | 删除光标前内容 |
| `Ctrl+K` | 删除光标后内容 |
| `Ctrl+W` | 删除前一个单词 |
| `Ctrl+C` | 中断运行中的 Agent / 退出 |

## 界面结构

```
┌───────────────────────────────────────────────┐
│  agent-team  •  workspace path  •  agents     │  Header
├───────────────────────────────────────────────┤
│  Context  •  lane overview  •  focus info     │  Context Panel
├───────────────────────────────────────────────┤
│                                               │
│  [Claude Code]  12:01              live        │
│  好的，我来分析一下代码结构...                │  Message Stream
│  ▸ tool read_file • src/index.ts              │  (scrollable)
│                                               │
│  [Codex]  12:03                    done        │
│  → delegated to Claude: review the plan       │
│                                               │
├───────────────────────────────────────────────┤
│  tail 5/5 │ Claude running │ queue clear      │  Status Bar
├───────────────────────────────────────────────┤
│  > @Codex implement the refactor plan█        │  Input Box
└───────────────────────────────────────────────┘
```

## 架构

```
src/
├── index.tsx              # 入口
├── types.ts               # 全局类型
├── core/
│   ├── router.ts          # 消息路由、任务队列、状态管理
│   ├── delegation.ts      # Agent 间委派协议解析
│   ├── commandParser.ts   # 用户输入解析（@mention、/命令）
│   ├── prompt.ts          # Agent 系统提示词构建
│   ├── persistence.ts     # Session 与消息日志持久化
│   ├── registry.ts        # Driver 注册表
│   └── utils.ts           # 工具函数
├── drivers/
│   ├── base.ts            # JSONL 流式 Driver 基类
│   ├── claude.ts          # Claude Code driver
│   ├── codex.ts           # Codex driver
│   ├── kimi.ts            # Kimi CLI driver
│   └── index.ts           # 默认 registry 工厂
└── tui/
    ├── App.tsx            # 根组件、状态、键盘处理
    ├── Header.tsx         # 工作区 + Agent 状态面板
    ├── ContextPanel.tsx   # 会话概览 + 焦点消息详情
    ├── MessageStream.tsx  # 消息列表（虚拟滚动窗口）
    ├── MessageBubble.tsx  # 单条消息气泡
    ├── MarkdownText.tsx   # Markdown 渲染
    ├── StatusBar.tsx      # 底部状态栏
    ├── InputBox.tsx       # 输入框 + 光标 + 补全
    ├── motion.ts          # 动画函数 + 订阅式 beat hook
    └── insights.ts        # 派生数据（会话统计、草稿分析）
```

### 核心设计

- **App 是消息总线**：所有消息（含 Agent 间通信）都经过 `MessageRouter` 路由，你随时可以看到完整消息流
- **Agent 自管上下文**：每个 Agent CLI 自身维护对话历史，app 只存 session ID，resume 时透传
- **模块化 Driver 接入**：新增 Agent 只需实现 `AgentDriver` 接口并注册，上层逻辑不变
- **订阅式动画**：只有需要动画的组件订阅全局 beat，不波及整棵组件树，避免终端闪动

### AgentDriver 接口

```typescript
interface AgentDriver {
  readonly name: AgentName;
  readonly displayName: string;
  send(opts: SendOptions): AsyncIterable<AgentEvent>;
  abort(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
```

三个 Driver 都继承自 `BaseJsonlDriver`，通过 `spawn` 启动对应 CLI 进程，解析 JSONL 流式输出为统一的 `AgentEvent` 序列。

## 数据存储

- Session 信息：`~/.agent-team/sessions.json`
- 消息日志：`~/.agent-team/messages/<hash>_<sessionId>.jsonl`

按工作目录隔离，不同项目的 session 互不干扰。

## 测试

```bash
npm test
```

覆盖 router、delegation parser、command parser、driver event mapping、persistence 等核心模块。

## License

Private
