# TUI 闪动问题排查与修复方案

## 现象

在 `agent-team` 中让 AI 持续执行任务时，终端界面会明显闪动，表现为消息区和输入区频繁整体重绘，用户会感觉命令行在“抖动”或“刷屏”。

这个问题在以下场景更明显：

- Agent 正在流式输出文本
- 同时存在 `thinking` / `tool` / `stderr` 事件
- 有多个 agent 处于运行或排队切换阶段

## 已确认的根因

### 1. 每个 streaming 消息都有独立 spinner 定时器

`src/tui/MessageBubble.tsx` 里的 `useSpinner()` 会在消息处于 `streaming` 状态时启动一个 `80ms` 的 `setInterval()`。  
这意味着只要有一条正在流式输出的消息，TUI 就会被该定时器持续驱动刷新；如果未来支持多个并发 streaming message，刷新频率还会叠加。

这类“动画型刷新”对 Ink CLI 很不友好，因为 Ink 的更新通常会导致整棵视图树重新布局和重绘，而不是浏览器那种局部增量绘制。

### 2. 每条流式事件都会立刻触发一次全局 emit

`src/core/router.ts` 中的以下路径都会在更新后立即 `emit()`：

- `appendMessage()`
- `pushContent()`
- `mergeUsage()`
- 部分队列/状态切换逻辑

而流式事件本身是高频的，尤其是：

- `text`
- `thinking`
- `tool_use`
- `tool_result`
- `stderr` 映射出的 `thinking`

结果就是 UI 会被高频推送状态，Ink 几乎每个 chunk 都会重绘一次。

### 3. emit 时对整个状态做 deep clone，放大了刷新成本

`router.emit()` 会调用 `snapshot()`，而 `snapshot()` 当前使用 `structuredClone(this.state)`。

这有两个副作用：

- 每次流式事件都会复制整份 `AppState`
- `messages` 越多、单条消息内容越长，复制成本越高

也就是说，现在不仅“刷新频率高”，而且“每次刷新都重”。

### 4. stderr 噪音也被当成 UI 流式内容持续推送

`src/drivers/base.ts` 当前会把 stderr 的每一行都转成：

- `{ type: 'thinking', content: "[stderr] ..."}`

这对调试有帮助，但对于像 Codex 这类 CLI 来说，stderr 里常混入插件 warning、收尾日志或其它噪音。  
这些内容会进一步增加 `pushContent()` 次数，放大 UI 闪动。

## 结论

闪动不是单一 bug，而是下面三类问题叠加导致的：

1. 动画刷新过于频繁
2. 流式事件没有做 UI 层节流
3. 每次更新的状态复制和渲染成本偏高

## 建议修复策略

建议按“先止血，再优化”的顺序处理。

### 第一阶段：最小可落地修复

目标：先把肉眼可见的闪动降下来，不做大规模架构重写。

#### A. 去掉消息级 spinner，改为静态 `live`

修改 `src/tui/MessageBubble.tsx`：

- 删除 `useSpinner()`
- `message.status === "streaming"` 时直接显示固定文案 `live`
- 不再用 `setInterval()` 驱动局部动画

这是收益最大、风险最低的一步，通常可以立即消除一大半闪动。

#### B. 给 router 的 UI emit 加节流

修改 `src/core/router.ts`：

- 增加 `emitTimer` / `emitQueued` 一类字段
- 把直接 `emit()` 改成 `scheduleEmit()`
- 将多个高频更新合并到一个短窗口内统一派发，建议窗口 `33ms` 到 `80ms`

推荐做法：

- `appendMessage()`, `pushContent()`, `mergeUsage()` 只更新内存状态，然后 `scheduleEmit()`
- `startTask()` 结束、session 切换、reset 这类低频操作可以继续立即 `emit()`

建议默认窗口先取 `50ms`，足够明显降低闪动，同时不会让流式体验显得卡顿。

#### C. 降低 snapshot 成本，先避免 deep clone 全量状态

修改 `src/core/router.ts`：

- 先不要用 `structuredClone(this.state)`
- 改成只创建新的顶层快照对象

推荐的最小方案：

```ts
private snapshot(): AppState {
  return {
    ...this.state,
    messages: [...this.state.messages],
    agents: {
      claude: { ...this.state.agents.claude },
      codex: { ...this.state.agents.codex },
      kimi: { ...this.state.agents.kimi }
    }
  };
}
```

这个方案不是最理想的不可变数据实现，但可以显著降低每次 `emit()` 的成本，足够作为第一版修复。

#### D. 对 stderr 做轻量过滤或降级

修改 `src/drivers/base.ts`：

- 保留 stderr，但不要无脑逐行推入 UI
- 优先过滤空行、纯 warning 噪音、明显无业务价值的收尾日志
- 或者给 stderr 单独做更粗粒度的合并

最低可接受方案：

- 只保留非空 stderr
- 连续 stderr 行在 driver 层先拼接后再发出

如果希望改动更小，也可以先不做这一步，把它放到第二阶段。

## 第二阶段：推荐优化

这部分不属于“先修掉闪动”的必要条件，但值得后续补上。

### 1. 把 router 更新改成真正的不可变写法

当前 `pushContent()` / `mergeUsage()` / `updateMessageStatus()` 都在原地修改 message。  
长远看，更稳妥的方式是每次只复制被修改的 message 和相关数组，让 `snapshot()` 可以直接返回 `this.state`。

这样能让状态流更清晰，也更便于后面做 `React.memo`。

### 2. 对 MessageBubble 做 memo

在状态更新改为不可变之后，可以考虑：

- `React.memo(MessageBubble)`

这样当只有最后一条 streaming message 更新时，其它历史气泡不会跟着重复 render。

### 3. 如果仍然需要动画，只保留一个全局低频动画源

如果产品上仍然想保留“活跃中”的视觉反馈：

- 不要给每条消息一个 spinner
- 可以只在 Header 上保留一个全局 spinner
- 刷新频率不要高于 `250ms`

CLI TUI 里，稳定性比炫动效重要。

## 推荐实施顺序

1. 删掉 `MessageBubble` 的 `useSpinner()`
2. 给 `router.emit()` 加 `scheduleEmit()` 节流
3. 把 `snapshot()` 从 `structuredClone()` 改成浅层快照
4. 跑测试并手动验证长输出场景
5. 视结果决定是否继续处理 stderr 合并

## 验收标准

修复完成后，至少满足以下标准：

1. 单 agent 持续输出 10 秒以上时，终端不再出现明显整屏闪烁
2. 输入框在流式输出期间保持稳定，不出现持续跳动
3. 流式文本仍然能连续更新，延迟体感不明显
4. 现有测试通过
5. session、queue、delegate 行为不回归

## 建议补充测试

### 单元测试

在 `test/router.test.ts` 增加：

- 高频 `pushContent()` 触发时，`emit` 次数会被节流
- 连续 `mergeUsage()` 不会导致状态丢失

### 手动验证

建议用一个会稳定输出较长文本的 prompt 手测：

- 观察连续 15 到 30 秒输出时是否仍有肉眼可见闪动
- 观察切换选中消息、展开 tool block 时是否有异常抖动

## 给 kimi 的执行说明

请按以下范围修改：

- `src/tui/MessageBubble.tsx`
- `src/core/router.ts`
- 如有必要再改 `src/drivers/base.ts`
- 为节流逻辑补充测试到 `test/router.test.ts`

先完成第一阶段，不要顺手做大规模状态管理重构。  
目标是先把终端闪动压下去，并保证现有交互不回归。
