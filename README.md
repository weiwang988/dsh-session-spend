# dsh-session-spend

> 源码：[github.com/weiwang988/dsh-session-spend](https://github.com/weiwang988/dsh-session-spend) · 兼容 DSH **`0.1.5` 线**（`dsh-v0.1.5-rc.1` = 当前 npm `latest`；session format v3 词表；见[兼容性注记](#兼容性注记适配-dsh-015-线)）

DSH（DeepSeek Harness）Web 客户端插件：实时显示**当前会话花费**（¥），按官方**峰谷计价**逐笔选档，悬停查看节省分解。零 host 改动，纯客户端。**适配 DSH 0.1.5 线**（浏览器端契约 = `@deepseek-ai/dsh-client-*` 0.1.5 线，session format v3：`assistant/attempt` + 内嵌 stream、transient `assistant/live-chunk`、`llm/retry-started` 槽位语义）；host 半经 `sessionPersistence.open(id,'read') → handle.read()`（返回 `{eventState, events}`）直接读取**解码后的逻辑事件流**（格式迁移由 DSH 的 v0→v1→v2→v3 链完成），完整会话账本同价同规则。

## 功能

- **会话花费**：只算当前会话主对话调用——与聊天统计行的 token 账目**同源且逐笔对齐**（v2 规则：`assistant/attempt` / `assistant/message` 各贡献其**内嵌 stream 的最后一条 usage**（`data.usage` 优先），按 `(turn, step, generation)` 槽位 last-wins；`llm/retry-started` 开新槽，**重试请求与失败请求都计入**——与 token-meter 的 replacement/retry 语义一致）。
- **峰谷计价**：每笔请求按**事件时间戳**判定高峰/低谷，套对应单价；显示「当前高峰中/低谷中」徽标。
- **切模型按模型计**：会话中途切换模型时，每笔按**该步实际路由模型**的单价计价（`message.source.model` 逐笔归属；**failed/attempt 记录无自带模型 → 归因最近先行 `request/header` 的 `config.model`**，与 DSH 每请求的路由一致）；tooltip 的「模型分解」列出每个模型的花费份额。
- **节省分解**（悬停 tooltip）：总计 / 低峰节省 / 缓存节省 / 模型分解；未配置价格的模型显示「价格未知」，**从不猜测**。
- **账户余额**：每轮结束后同源刷新一次（事件驱动，无轮询）；经 host 端 `GET /user/balance` 官方接口（凭证取 DSH 设置的 `DEEPSEEK_API_KEY`），失败（未配置 key / 网络错误）**静默隐藏**，多币种非零显示。
- **价目可配置**：设置页「插件配置」卡片（`session-cost` 命名空间）编辑三档模型高峰价（¥/百万）+ 低谷系数，即时生效于下一次结算。
- **口径**：不含压缩总结、标题生成、子代理调用（后续版本提供开关）。
- 展示位：`conversation.composer.dock`——与统计行同一横带（虚拟列表插槽，第三方可直接注册）。

## 官方价目（内置默认 · 采集日 2026-09-10）

来源：[DeepSeek API 官方价目页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)（2026-09-10 抓取核对，Flash 系列当时刚降价 ~60%）。默认值**随插件版本固化，官方调价后请更新 `src/core/price.ts` 与 `src/core/config.ts`**（窗口规则在 `src/core/window.ts`，未变），或改用自定义价目（见下）。

单位 ¥/百万 token：

| 模型 | 输入·缓存命中 峰/谷 | 输入·未命中 峰/谷 | 输出 峰/谷 |
|---|---|---|---|
| **deepseek-flash**（DeepSeek-V4.1-Flash，DSH 0.1.5 默认） | 0.04 / 0.02 | 2.0 / 1.0 | 8.0 / 4.0 |
| deepseek-v4-pro（DeepSeek-V4-Pro-0813） | 0.30 / 0.15 | 9.0 / 4.5 | 27.0 / 13.5 |
| deepseek-v4-flash（旧名，官方按 Flash 价计费） | 0.04 / 0.02 | 2.0 / 1.0 | 8.0 / 4.0 |
| deepseek-v4-flash-vision-exp（旧名，同上） | 0.04 / 0.02 | 2.0 / 1.0 | 8.0 / 4.0 |

官方口径注记：旧模型名 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 仍可调用，但对应模型已下线，**请求由 V4.1-Flash 提供服务并按 Flash 价格计费**；`deepseek-v4-pro` 计划下线，**北京时间 2026-09-14 12:00 之后其请求将全部路由到 V4.1 Flash 并按 Flash 价计费**——到那天把 `price.ts`/`config.ts` 的 pro 行改成 Flash 价（或直接用设置卡改）即可。

**高峰时段 = 北京时间周一至周五 9:00–12:00、14:00–18:00**（区间起点含、终点不含；周末、午间、晚间、凌晨均为低谷），低谷价 = 高峰价 × 0.5。

## 安装（bundle + profile 机制）

本包是一个 **bundle**（`dsh.bundle` + `cordis.patch.yml`），安装进 DSH 的 **profile**（`$DSH_HOME/profiles/<name>`）即生效——与其它 DSH 插件一致，"放进 profile"由 `dsh plugin` 命令完成：

```bash
# 1) 先构建（package.json 有 prepare 脚本；本地 add 链接的是源码检出，需要 lib/ 产物）
pnpm install && pnpm run build

# 2) 安装进你的 Web profile（`dsh web` 即 `--profile web`；相对路径以调用目录为准，所以在 checkout 内 `add .` 装的就是这个 checkout）
dsh plugin --profile web add .
# 或从任意目录：dsh plugin --profile web add ./dsh-session-spend

# 3) 核对层，然后启动
dsh --profile web --dump-config      # 应出现 "# == dsh-session-spend" 层
dsh --profile web
```

其它来源同样支持（本包**不发布 npm**，推荐 GitHub git 安装或 tarball）：

```bash
dsh plugin --profile web add github:weiwang988/dsh-session-spend#v0.1.0   # git 安装（推荐，pin 发布标签）
                                                            # 包内有 prepare 会自动构建，
                                                            # 需按提示在 profile 的 pnpm-workspace.yaml
                                                            # 允许该包构建（allowBuilds）
dsh plugin --profile web add ./dsh-session-spend-0.1.0.tgz   # pnpm pack 产物（免构建许可）
dsh plugin --profile web remove dsh-session-spend     # 卸载
```

> 若未来要发 npm：`pnpm publish` 的 prepare 构建已配置好，发布后用户侧 `dsh plugin --profile web add dsh-session-spend`。

源码仓库：[https://github.com/weiwang988/dsh-session-spend](https://github.com/weiwang988/dsh-session-spend)（`main` + 发布标签 `v0.1.0`）。

**生效机制**：patch 行 `{id: session-spend, name: dsh-session-spend}` 进入 Web 组合；[`@deepseek-ai/dsh-client-modules`](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/client/modules) 扫描组合行，发现本包 `dsh.client` 清单 → 解析 `exports["./client"]` → 生成 `window.__DSH_BOOT__` 清单并 serve `/plugins/session-spend/client.js` → 浏览器端 `apply` 注册定义/视图/dock 条目。**无需 fork DSH、无需改任何 bundle 源码。**

**开发热更新**：本地 `add ./` 后改了源码，运行 `pnpm run build`（服务端 serve 的是 `lib/client.js` 而非源码），刷新浏览器即可。从未 build 就 add 会报 `client-modules: ...exports no "./client" bundle`。

**层序**：profile bundles 列表序 → 各 bundle patch → profile 自身 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` 参数。后续层可覆盖/禁用本包行（`- {id: session-spend, disabled: true}`），改动不用碰本包。

**定义不再重复**：本包同时声明 `dsh.client`（插件面）与 `dsh.bundle`（安装面）——两者可共存；只有 bundle 声明而无 client 清单的包装进去只算普通依赖，不会激活。

### 开发期自检

```bash
pnpm install && pnpm run build   # 构建 lib/ 产物
npm test                         # node:test（纯函数核心 + ViewBuilder）
npm run typecheck                # 需安装 @deepseek-ai/* 真实类型
npm run typecheck:offline        # 无网络环境（经 types/ 类型镜像）
```


## 架构

```
事件流(窗口+实时) ──> conversationEvents.register(NodeDefinition 'session-cost')
                        每步一个 Context（step/start 起始；live-chunk/attempt/message/
                        retry-started 增量更新：append-only 采样+重试历史）
                        每个 request/header 一个 Context（路由模型事实）
                     └─> conversationViews.register(ViewDefinition 'cost')
                        全部节点 → seq 有序 foldCostItems：按 (turn,step,generation)
                        槽位 last-wins、retry 追加、header 模型归因 → 逐笔高峰/低谷计价
conversation.composer.dock 条目 ← 读快照 session.views.get('cost')
```

- 分页/重放：引擎 `replaceWindow` 重建全部节点（Context 从 matches 重放，append-only 状态确定），ViewBuilder `replace()` 全量重算——**不会重复计费**。
- 实时：live-chunk usage 帧 `animation-frame` 节奏刷新（引擎结算时 transient 被退休、Context 以其实际 matches 重放）；与统计行节奏一致，无流式粗估。

## 兼容性注记（适配 DSH 0.1.5 线）

适配对象为 **format v3** 事件词表（`dsh-v0.1.5-rc.1` = 当前 npm `latest`；v3 自 0.1.3-alpha.2 起生效），要点：

- **持久化面**：`sessionPersistence.open(id, 'read')` → `handle.read(offset?, length?, options?)` 解析为 **`SessionHandleReadResult`（`{ eventState, events }`，0.1.5 线起）**——本包取 `.events`（注意 0.1.3 线旧形态是裸 `SessionEvent[]`，两者本包都兼容：旧线返回数组时 `.events` 为 undefined，请以 0.1.5 为准；0.1.2 线的 `readRaw/supportsRawArtifacts` 回退已移除——旧线请用 tag `v0.1.0` 的包）。
- **词表变化**（相对 0.1.2 线）：持久化词表里再无 `assistant/chunk`，新增 **`assistant/attempt`**（失败的模型尝试也留账）；`assistant/message` 内嵌完整紧凑模型流 `stream`（`usage` 仍在）；客户端事件的 `SessionEventLike` 新增 **transient `assistant/live-chunk`**（`{attemptId, turn, step, chunk}`，结算后由 `settle-assistant` 退休替换）；`llm/retry` / `llm/retry-started` 为持久化重试记录。
- **v3 增量**（相对 0.1.3-alpha.1，均与计费无关）：system prompt 上浮为 surface 节点（新事件 `system/message`，`request/header` 不再携带 `system`，但 `config.model` 不变）；`tool/code-dispatch*` → **`tool/ptc-dispatch*`**；新增 `feedback/message-put/delete`；`sourceEventSeqs` 从 wire 类型移除；token-meter 的 usage 提取重构为 `lastAssistantStreamChunk`（**语义不变**：`data.usage` 优先，否则 stream 最后一条 usage chunk）。
- **计费口径**：usage = `data.usage` ?? 内嵌 stream 中**最后一条** usage chunk（plain `{type:'chunk'}` 记录；packed text/reasoning/tool-call 行不含 usage）；`llm/retry-started(turn,step)` 开**新槽位**——重试后的下载样本是**追加**不是替换（失败请求与重试请求都真实计费）。
- **模型归属**：`assistant/attempt` 无 `model` 字段；归因最近先行的 `request/header`（`header.config.model`，DSH 只在配置变化时重新记录，因此"最近先行头"就是本次请求的模型）；取不到才标「价格未知」。
- 浏览器端契约（`conversation.composer.dock`、NodeDefinition/ViewDefinition/register、locale、settingsScope）在 0.1.2-rc.1 → 0.1.5 线之间**无破坏性变化**；事件词表与持久化返回值是唯一破坏点。本包 src 对事件做结构化访问（`CostEventLike`），因此在 0.1.2 发布类型的笔形下也可 typecheck；devDeps 现在可升到 **0.1.5-rc.1**（npm 已发布该版本），或留待 0.1.5 正式版。
- **模型变更**：DSH 0.1.5 把 DeepSeek 默认模型换成 `deepseek-flash`（DeepSeek-V4.1-Flash），旧名 `deepseek-v4-flash` / `-vision-exp` 由它代跑、pro 计划 2026-09-14 12:00 起路由到它——价目表已按官方 2026-09-10 新价同步（见上表）。

> 注：0.1.5 线把聊天区的「统计条」换成了两个图标 pill + 点击打开的统计对话框——本包挂在 `conversation.composer.dock` 槽位，与统计条布局相互独立；如果官方新的统计对话框也提供同源数据入口，可作为后续对齐点。

## 与现有同类插件的差异

RoxsLee/dsh-cost-plugin（峰谷按时间戳+余额）、Lzh3070/dsh-session-cost（逐消息+明细+余额）等已覆盖「统计行旁读金额」。本项目差异化：

1. 事件级 last-wins（含重试槽位）与统计行账目逐笔对齐——failed attempt、重试与终值消息均按 token-meter 的 replacement/retry 语义折算，同一口径可逐笔核对；
2. 低峰+缓存节省分解与峰/谷当前状态徽标；
3. 未知模型不猜价、显示「价格未知」；
4. 纯函数核心（window/price/fold/cost）独立可测，价目与窗口规则全量配置化。

## Known Limitations and Deferred Work

- **读数是"全量"且零窗口成本**：会话总账由 **host 端从持久化日志折叠**（0.1.5 线 `sessionPersistence.open(id, 'read')` → `handle.read()` 取**解码后的逻辑事件流**（`{eventState, events}`；v0/v1/v2 旧文件由 DSH 格式链自动迁移到 v3，未知词表 fail-closed），客户端**永不翻页**——客户端窗口从不膨胀，会话二次进入零额外成本（补齐了纯客户端窗口方案的短板）。每次轮次结算 host 重读一次该会话日志（大日志的 host 侧成本，后续可加 revision 缓存）。注意 0.1.5 线的 `eventState` 指示事件值所有权——本包只读取折叠，不保留引用，无需特殊处理。
- **今日(DSH)**：host 端跨所有会话按北京时间今日边界汇总（同口径=主对话调用）；与官方控制台差异（标题/压缩等隐性调用）依旧体现在"今日"之外。
- **「当前高峰/低谷」徽标按组件渲染时刻计算**——会话空闲时不会自动翻牌（下一次事件驱动重渲染时更新）。后续可改为定时刷新。
- **不含压缩总结/标题生成/子代理**——这些调用在官方口径下同样计费；未来以配置开关引入（`includeCompaction` / `includeTitleGen` / `includeSubagents`）。
- **默认价目为 2026-09-10 采集**（Flash 系列降价后；`deepseek-flash`/V4.1-Flash 为新默认，旧 flash 名按 Flash 价）——官方再次调价后需同步更新 `price.ts` / `config.ts`（2026-09-14 12:00 后 pro 将路由到 Flash 计费，届时改 pro 行）。
- **余额/今日 = host 端能力**：需要 Vite 同源 `/_dsh-cost/summary` 路由（本包 host 半）与 DSH 配置的 `DEEPSEEK_API_KEY`；未配置/失败时余额段静默隐藏（其余功能不受影响）。
- 本插件仅按模型单价估算，**不构成官方账单**；对账以 DeepSeek 控制台为准。
