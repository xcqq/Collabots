# Collabots — 多任务 × 多 agent 调度台

## 定位

不是一个聊天客户端，是一张**调度台**。用户打开它的唯一目的是回答一个问题：
"现在需要我动手的是什么？"

所有设计取舍都服从这条：让 90% 的时间处在"看板静默、你干自己的事"，只在需要你的时候把你叫醒。

---

## 一、后端底座：dsh（DeepSeek Harness）的真实能力

已确认 (`@deepseek-ai/dsh@0.2.2-rc.5`, CLI `0.2.1-rc.3`, `github.com/deepseek-ai/deepseek-harness`)：

| 面 | 形态 | 用途 |
|---|---|---|
| `dsh --profile headless --json "<task>"` | **NDJSON run events → stdout** | 一次性任务，结构化事件，最好接 |
| `dsh --profile headless --session-id <id> "继续"` | 恢复已有 Session | 多轮对话的基础 |
| `@deepseek-ai/dsh-sdk-app` | **stdio JSON-RPC + 进程生命周期** | 长活交互 session |
| `@deepseek-ai/dsh-acp-app` | ACP JSON-RPC stdio（automation-only） | 备用/标准化路径 |
| `@deepseek-ai/dsh-headless` | 无 Host/HTTP/浏览器层的一次性 runner | headless profile 的内核 |
| `@deepseek-ai/dsh-schedule` | 基于 session event log 的持久定时器 | 定时任务 / 延后重试 |
| `@deepseek-ai/dsh-token-meter` | token 计量 | 卡片上直接显示成本 |

Session 持久化在 `~/.dsh/storages/session_projcache/sessions/session-<uuid>.json`，
结构 `{version, record:{identity:{cwd, createdAt, ...}, rows:{...}}}`，rows 含
`turnBoundary` / `inbox` / `goal` / `title` / `tokenUsage` / `tokenCost` /
`sessionStats` / `contextPressure` / `sandboxMode` / `llmRetry`。

**结论**：不需要 PTY + ANSI 嗅探。`turnBoundary` 直接给回合边界，`inbox` 直接给
"有东西等你"，`tokenUsage` 直接给成本。状态探测从"猜"变成"读"。

### 一个关键副作用：session 按 cwd 归属

`~/.dsh/sessions/<slug(cwd)>/` —— 同一目录下的任务共享 session 命名空间。
所以**每个任务必须有自己的工作目录**，否则 session 会串、多个 agent 同时改一个
repo 会互相踩。→ git worktree 从 P2 提前到 P1。

```
git worktree add .collabots/tasks/<task-id> -b task/<task-id>
```

好处全是顺带的：隔离、可 diff 验收、session 天然分组、失败直接丢弃 worktree。

---

## 二、状态机（6 态，全部由 dsh 事件推导）

| 状态 | 触发 | 用户动作 |
|---|---|---|
| `queued` | 创建任务 / 等并发槽 | 无 |
| `running` | `turnBoundary` 开始 | 无 |
| `needs_input` | agent 提问 / 请求权限 / `inbox` 非空 | **回答（最高优先级）** |
| `review` | 回合正常结束且有产出 | 看 diff，通过或打回 |
| `failed` | 非 0 退出 / 崩溃 | 看原因，重试或改 prompt |
| `stalled` | `running` 且超过 N 分钟无事件 | 杀进程重启 |

`events` 表是事实（全量落库），`tasks.status` 是派生视图。重启后从 events 重算，
看板不会说谎。`stalled` 是真实世界最高频的故障，必须有。

---

## 三、界面结构

```
┌──────────────────────────────────────────────────────────┐
│  Inbox(3)   Board   ⚙         [⌘K 搜索]        ● 3 running │
├──────────────────────────────────────────────────────────┤
│  Queued    Running      Needs you    Review     Failed     │
│  ┌────┐    ┌────┐       ┌────┐       ┌────┐    ┌────┐     │
│  │card│    │card│  ←    │card│       │card│    │card│     │
│  └────┘    └────┘       └────┘       └────┘    └────┘     │
└──────────────────────────────────────────────────────────┘
```

**卡片**：标题 / agent / 分支 / 最后一行进度 / 耗时 / token / 状态点。
不显示原始输出流 —— 那是噪音。

**Inbox（首屏红点 → 全屏 triage）**：跨任务的待办队列，一条一条键盘处理。
这是整个产品的核心，不是附件。

**任务创建（全部从 UI 发起）**：
- 选目标仓库 → 自动开 worktree → 起 session → 发 prompt → 卡片进 `queued`/`running`
- 字段：标题、prompt、仓库、agent、模型、优先级、是否自动开 worktree
- 支持**草稿**：先写下来不启动，攒到有空再放行
- 支持**模板**：常用 prompt 前缀（修 bug / 补测试 / 调研 / 重构），避免每次从零写
- 创建后立刻要有可见反馈（卡片滑入 Running），否则用户会重复点击

**任务详情**：
- 左：对话，工具调用默认折叠，只显示每轮一句话摘要 + 最终产出
- 右：元信息、产出 diff、timeline（状态变迁 / 每次提问 / 每次回答 / 成本）
- 底：输入框，**随时**可对任意 session 说话；`⌘J` 一键打开真实终端兜底

**中途对话的两种语义（必须显式区分）**：
- **排队**（默认，Enter）：消息在下一个 turn 边界送达，不打断正在做的事
- **打断**（⌘⏎）：中止当前回合，立刻按新指令走

默认打断会让 agent 永远干不成长活；默认排队又会让"我发现它跑歪了"无法及时纠正。
所以两者都要有，且默认必须是排队。

视觉上也要分开两类消息：**你的指令**（蓝）和**它的提问**（黄，`needs_input`）——
前者是你在指挥，后者是它在求确认，混在一起看会分不清谁在等谁。

**键盘**：`j/k` 移动、`Enter` 打开、`i` 回复、`a` 归档、`/` 过滤、`⌘K` 搜索。

---

## 四、通知（本机浏览器）

用 Page 级 `Notification` API，不需要 Web Push、不需要 HTTPS、不需要 PWA：
- 只在 `needs_input` 和 `failed` 弹（`review` 可选）
- 同任务 30s 内多事件合并成一条
- 点通知聚焦到那条提问的输入框
- 附带：标签页标题 badge `(3)` + favicon 红点 + 可选提示音

Background 标签页同样能弹；只有完全关掉页面才停 —— 这在"只本机浏览器"的约束下
是可接受的取舍，换来零部署成本。

---

## 五、技术栈

pnpm workspace，TypeScript 全栈：

```
apps/server    Fastify + ws + better-sqlite3 + zod
               ├ Board   状态机 / 事件总线
               ├ Runner  进程池 / 并发槽 / worktree 管理
               ├ Dsh     headless --json + sdk-app JSON-RPC 适配
               └ Notify  合并 / 去重 / 推送
apps/web       React + Vite + Tailwind + TanStack Query + dnd-kit
packages/shared  事件类型定义（前后端共用，端到端类型安全）
```

单进程 + launchd 常驻，`http://localhost:PORT`，无认证。
终端兜底视图用 xterm.js（P2）。

---

## 六、数据模型

```sql
tasks(id, title, prompt, repo_path, worktree_path, branch, agent, status,
      priority, created_at, started_at, ended_at, parent_id, archived)
sessions(id, task_id, dsh_session_id, cwd, pid, status, started_at, ended_at,
         last_event_at, exit_code, tokens, cost)
events(id, session_id, seq, ts, kind, payload_json)   -- 事实，可重放
questions(id, task_id, session_id, text, options, asked_at, answered_at, answer)
notifications(id, task_id, kind, sent_at, read_at)
```

`task_id → sessions` 是 1:N 而不是 1:1 —— 今天一个任务一个 session，但重试、
拆分子任务、换 agent 都需要多 session，模型先留好。

---

## 七、落地顺序

**P1（能用）**
- dsh worktree 隔离 + 任务 CRUD
- 看板 5 列 + 状态由 `headless --json` 事件驱动
- 任务详情：对话流（折叠工具调用）+ 内联回答（`--session-id` 续聊）
- 浏览器通知（needs_input / failed）+ 标题 badge
- SQLite 持久化，重启恢复

**P2（好用）**
- `dsh-sdk-app` JSON-RPC 长连接，替掉「每次回复起一个进程」
- git diff 验收视图 + 一键打回
- 并发队列 + 优先级
- Inbox triage 视图
- xterm.js 终端兜底

**P3（顺手）**
- 多 harness adapter（claude / codex）
- 任务模板 / 批量创建 / 任务树
- token 与耗时统计看板
- `dsh-schedule` 定时任务

---

## 八、已验证 / 待验证

**已验证**（`dsh --profile headless --json "..."` 实跑）：

```jsonc
{"type":"session","sessionId":"session-83b6…","cwd":"/private/tmp/dsh-probe"}
{"type":"status","phase":"turn_start","turn":1}
{"type":"status","phase":"step_start","turn":1,"step":1}
{"type":"status","phase":"step_end","turn":1,"step":1}
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error",...}}
{"type":"final","text":""}
```

NDJSON 一行一事件，`turn_start`/`turn_end` 直接映射 `running`/`review`。
这一层足够做状态机，不需要解析 ANSI。

**已验证的问题**：headless profile 默认走 `deepseek-official` 路由，缺
`DEEPSEEK_API_KEY`。本机实际走 magpie 网关（`127.0.0.1:3425`）。→ Collabots 需要
自带一个 dsh profile，用 `--patch` 把 `agent-default-model` 指到 magpie。

**待验证**：
1. `dsh-sdk-app` 的 JSON-RPC 方法名（本地只有 desktop/web/tui/headless 四个 profile）
2. 提问/权限请求在 NDJSON 里长什么样 —— 决定 `needs_input` 能否精确判断
3. `inbox` row 是否原生支持"回合中注入用户消息"（决定 steer 怎么实现）
4. `--session-id` 续聊能否拉到完整 transcript，还是只能读 storages 的 row log
