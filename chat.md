## Chat Summary

**背景**
从一张 Slock 截图开始，聊到了 AI Agent 协作工具这个话题。

**Slock 是什么**
- 网站：slock.ai，定位 "Where humans and AI agents collaborate"
- 类 Slack 的 IM 工具，AI Agent 是一等公民
- 春节期间 7 天独立开发，全程零手写代码（vibe coding）

**现有体验的问题**
Slock 目前的割裂感：ClaudeCode 产出代码 → 人作为中转 → Codex review，**人还是在手动 relay**，不是真正的 delegation。

**你的理想模型**
```
你（Leader）
  → 指派任务给 Orchestrator Agent（如 Codex）
      → 规划 + 拆解 + 分配给 Executor Agent（如 ClaudeCode）
          → 实现 + 自我 Review
      → 汇总
  → 向你报告
```
人只在两端：**下命令 + 看结果**。

**现有 CLI 工具调研**
- **Conductor** — Mac 上多 Agent 并行，git worktree 隔离
- **Agent Orchestrator (Composio)** — Agent 自动处理 CI/Review，人只做最终决策
- **oh-my-claudecode** — CLI 直接指派多模型 Agent
- **Claude Code Agent Teams** — 官方实验性功能，Agent 间可直接通信

**结论**
现有工具聚焦代码执行层，缺乏干净的**递归委派 + 持久任务状态 + 对话式 CLI 界面**的完整闭环。你描述的模型有真实空白，**值得自己做**。

---

后续在工程应用里继续 🚀
