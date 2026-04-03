<div align="center">

# agent-team

**把 Claude Code、Codex、Kimi 拉进同一个终端群聊，让它们自己干活。**

你 `@` 谁谁就动，Agent 之间还能互相派活，你只管下令和收货。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Ink](https://img.shields.io/badge/TUI-Ink%205-000?logo=react&logoColor=white)](https://github.com/vadimdemedes/ink)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

---

## Demo

```
┌──────────────────────────────────────────────────┐
│ ◐ agent-team                 2 hot • 3/3 online  │
│ ws Space/agent-team     ses Session 1 • 1        │
├──────────────────────────────────────────────────┤
│ • Conversation                    5 msgs • idle  │
│                                                  │
│ ╭──────────────────────────────────────────────╮ │
│ │ ▶ Claude Code • reply + tools        live    │ │
│ │   好的，我来分析一下代码结构...              │ │
│ │   ▸ tool read_file • src/index.ts            │ │
│ │   ▸ result read_file • export function...    │ │
│ ╰──────────────────────────────────────────────╯ │
│                                                  │
│   • Codex • delegate                       done  │
│     → delegated to Claude: review the plan       │
│                                                  │
├──────────────────────────────────────────────────┤
│ ◜ tail 5/5 │ Claude running │ queue clear        │
├──────────────────────────────────────────────────┤
│ > @Codex implement the refactor plan█            │
│   Enter sends to Codex                           │
└──────────────────────────────────────────────────┘
```

## Motivation

Claude Code、Codex、Kimi CLI、Copilot CLI 都很强，但它们各自为政。当你想让一个分析代码、另一个写实现、第三个做 review，你就变成了人肉消息中转站——复制输出、粘贴输入、来回切窗口。

agent-team 让你在一个终端里像群聊一样调度它们。Agent 之间可以自动委派任务，你只需要在起点下命令、在终点看结果。

## Quick Start

> **前提**：Node.js >= 24，且至少装了 `claude`、`codex`、`kimi`、`copilot` 四个 CLI 之一。

```bash
# 克隆 & 安装
git clone https://github.com/AceXiamo/agent-team.git
cd agent-team
npm install

# 开发模式（tsx 直接跑）
npm run dev

# 或者构建后运行
npm run build && npm start
```

启动后 agent-team 会自动检测本机可用的 CLI，Header 面板实时显示各 Agent 在线状态。

## Usage

### @ 就完了

```
@Claude 帮我把这个函数重构成 async 的
@Codex 看一下 src/ 目录，找出所有未使用的 export
@Kimi review 一下最近三次 commit
@Copilot 帮我梳理一下这个 workspace 的入口和状态流
```

一条消息里 `@` 一个 Agent，它就开始干活。流式输出实时显示在消息流里。

### Agent 自动协作

你可以让 Agent 们互相派活：

```
你 → @Codex 分析代码结构，让 @Claude 出一份重构方案

  Codex 分析完，自动委派给 Claude
  Claude 写完方案，回传给 Codex review
  Codex 汇总后把最终结果推给你

你 → @Codex 方案没问题，让 Claude 开始实现
```

整个过程你只在两头介入，中间 Agent 自治。

### 命令

| 命令 | 干嘛的 |
|------|--------|
| `/new [title]` | 新建 session |
| `/sessions` | 列出所有 session |
| `/switch <id>` | 切换 session |
| `/reset @Agent` | 清掉某个 Agent 的 session |
| `/agent @Agent on\|off` | 开关某个 Agent |

### 快捷键

| 按键 | 作用 |
|------|------|
| `↑` `↓` | 消息导航 |
| `Enter` | 发送 / 展开折叠块 |
| `Tab` | @mention 补全 |
| `Esc` | 清空输入 |
| `←` `→` | 移动光标 |
| `Ctrl+A` `Ctrl+E` | 行首 / 行尾 |
| `Ctrl+U` `Ctrl+K` `Ctrl+W` | 删前 / 删后 / 删词 |
| `Ctrl+C` | 中断 Agent / 退出 |

## Architecture

```
                  ┌─────────────┐
  你 ──→ InputBox │  @ mention  │
                  └──────┬──────┘
                         ▼
                  ┌─────────────┐    ┌─────────────┐
                  │   Router    │◄──►│ Persistence  │
                  │  (消息总线)  │    │ (session+log)│
                  └──┬───┬───┬──┘    └─────────────┘
                     │   │   │
              ┌──────┘   │   └──────┐
              ▼          ▼          ▼
        ┌──────────┐┌──────────┐┌──────────┐┌──────────┐
        │  Claude  ││  Codex   ││   Kimi   ││ Copilot  │
        │  Driver  ││  Driver  ││  Driver  ││  Driver  │
        └────┬─────┘└────┬─────┘└────┬─────┘└────┬─────┘
             │           │           │           │
             ▼           ▼           ▼           ▼
         claude CLI   codex CLI   kimi CLI   copilot CLI
```

**三个核心原则**：

1. **App 是总线** — 所有消息（含 Agent 间通信）都经过 Router，你能看到完整消息流
2. **Agent 自管上下文** — 对话历史由各 CLI 自身维护，app 只存 session ID
3. **Driver 可插拔** — 实现 `AgentDriver` 接口 → 注册到 registry → 完事

### 目录结构

```
src/
├── index.tsx               入口，启动 Ink 应用
├── types.ts                全局类型定义
├── core/
│   ├── router.ts           消息路由 + 任务队列 + 状态管理
│   ├── delegation.ts       Agent 间委派协议解析
│   ├── commandParser.ts    用户输入解析
│   ├── prompt.ts           系统提示词构建
│   ├── persistence.ts      Session & 消息日志持久化
│   └── registry.ts         Driver 注册表
├── drivers/
│   ├── base.ts             JSONL 流式 Driver 基类
│   ├── claude.ts           Claude Code
│   ├── codex.ts            Codex
│   ├── kimi.ts             Kimi CLI
│   ├── copilot.ts          Copilot CLI
│   └── index.ts            默认 registry
└── tui/
    ├── App.tsx             根组件 + 键盘处理
    ├── Header.tsx          Agent 状态面板
    ├── ContextPanel.tsx    会话概览
    ├── MessageStream.tsx   消息列表
    ├── MessageBubble.tsx   消息气泡
    ├── MarkdownText.tsx    Markdown 渲染
    ├── StatusBar.tsx       状态栏
    ├── InputBox.tsx        输入框 + 光标
    ├── motion.ts           订阅式动画
    └── insights.ts         派生数据
```

### 扩展新 Agent

```typescript
import { BaseJsonlDriver } from './base.js';

class CursorDriver extends BaseJsonlDriver {
  readonly name = 'cursor' as const;
  readonly displayName = 'Cursor';
  protected readonly binary = 'cursor';

  protected buildArgs(opts) {
    return ['--prompt', opts.prompt, '--json'];
  }
}
```

注册到 `drivers/index.ts` 就行，TUI 和路由层不用动。

## Tech Stack

| 层 | 技术 |
|----|------|
| TUI 框架 | [Ink 5](https://github.com/vadimdemedes/ink) (React for CLI) |
| 语言 | TypeScript 5.9 |
| 运行时 | Node.js 24+ |
| 测试 | [Vitest](https://vitest.dev/) |
| 布局 | Yoga Flexbox (Ink 内置) |

## Testing

```bash
npm test
```

7 个测试文件，51 个用例，覆盖 router、delegation、command parsing、driver event mapping、persistence 等核心链路。

## Contributing

1. Fork it
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## License

[MIT](./LICENSE) &copy; [AceXiamo](https://github.com/AceXiamo)
