# dsh-session-spend

> 源码：[github.com/weiwang988/dsh-session-spend](https://github.com/weiwang988/dsh-session-spend) · 兼容 DSH `0.1.2-rc.1` 发布线及 master 主线（见[兼容性注记](#兼容性注记适配-dsh-012-线已发布-rc1--master-主线)）

DSH（DeepSeek Harness）Web 客户端插件：实时显示**当前会话花费**（¥），按官方**峰谷计价**逐笔选档，悬停查看节省分解。零 host 改动，纯客户端。**兼容 DSH 0.1.2 线**（浏览器端契约 = `@deepseek-ai/dsh-client-*` 0.1.2-rc.1，与当前 npm 发布线及 host master 主线一致）；host 半对会话持久化做**双线适配**——`open(id,'read') → handle.read()` 接缝（master 线新增、尚未随已发布版本发出）与已发布 0.1.2 线的 `readRaw/supportsRawArtifacts` 回退，两条线的完整会话账本同价同规则；两者都缺失时静默降级为本地尾窗读数，详见「兼容性注记」。

## 功能

- **会话花费**：只算当前会话主对话调用——与聊天统计行的 token 账目**同源且逐笔对齐**（`assistant/chunk` usage 先行采样 → `assistant/message` 终值，按 `(turn, step)` last-wins 去重，镜像 token-meter 规则）。
- **峰谷计价**：每笔请求按**事件时间戳**判定高峰/低谷，套对应单价；显示「当前高峰中/低谷中」徽标。
- **切模型按模型计**：会话中途切换模型时，每一步按**该步实际使用模型**的单价计价（`message.source.model` 逐笔归属），历史步骤不重算；tooltip 的「模型分解」列出每个模型的花费份额。
- **节省分解**（悬停 tooltip）：总计 / 低峰节省 / 缓存节省 / 模型分解；未配置价格的模型显示「价格未知」，**从不猜测**。
- **账户余额**：每轮结束后同源刷新一次（事件驱动，无轮询）；经 host 端 `GET /user/balance` 官方接口（凭证取 DSH 设置的 `DEEPSEEK_API_KEY`），失败（未配置 key / 网络错误）**静默隐藏**，多币种非零显示。
- **价目可配置**：设置页「插件配置」卡片（`session-cost` 命名空间）编辑三档模型高峰价（¥/百万）+ 低谷系数，即时生效于下一次结算。
- **口径**：不含压缩总结、标题生成、子代理调用（后续版本提供开关）。
- 展示位：`conversation.composer.dock`——与统计行同一横带（虚拟列表插槽，第三方可直接注册）。

## 官方价目（内置默认 · 采集日 2026-08-28）

来源：[DeepSeek API 官方价目页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)（用户截图核对）。默认值**随插件版本固化，官方调价后请更新 `src/core/price.ts` 与 `src/core/window.ts`**，或改用自定义价目（见下）。

单位 ¥/百万 token：

| 模型 | 输入·缓存命中 峰/谷 | 输入·未命中 峰/谷 | 输出 峰/谷 |
|---|---|---|---|
| deepseek-v4-flash | 0.10 / 0.05 | 3.0 / 1.5 | 9.0 / 4.5 |
| deepseek-v4-pro | 0.30 / 0.15 | 9.0 / 4.5 | 27.0 / 13.5 |
| deepseek-v4-flash-vision-exp | 0.10 / 0.05 | 3.0 / 1.5 | 9.0 / 4.5 |

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
                        单事件 Context/步：usage 分片 & 终值各一，带 seq/time/model/usage
                     └─> conversationViews.register(ViewDefinition 'cost')
                        按 (turn,step) 取最大 seq（终值覆盖采样），逐笔高峰/低谷计价
conversation.composer.dock 条目 ← 读快照 session.views.get('cost')
```

- 分页/重放：引擎 `replaceWindow` 重建全部节点，ViewBuilder `replace()` 全量重算——**不会重复计费**。
- 实时：每条 usage 事件结算即刷新，与统计行节奏一致；无流式粗估。

## 兼容性注记（适配 DSH 0.1.2 线：已发布 rc.1 + master 主线）

2026-08-30 之后官方发布线与 master 主线出现了**两条并存**的持久化面，本包两条都吃：

| 线 | 持久化面 | 本包 host 半 |
|---|---|---|
| 已发布 `0.1.2-alpha.2 … alpha.5 / rc.1`（**rc.1 = 当前 npm `next` 发布物**） | `sessionPersistence.supportsRawArtifacts` + `readRaw(id)` → **原始 JSONL 文本**（首行是 `{type:'session'}` 格式头；delta chunk 可能被合入 `text-chunks` 等行） | `readRaw` 回退：`parseRawLogLines` 逐行解析（跳过格式头与 packed 行），再走同价同规则的 last-wins 折叠 |
| master 主线（`release/dsh-0.1.2-rc.1-version-to-master` 已合入，**当前 checkout 的版本号已是 rc.1**；下一个发布将带上 seam） | `open(id, 'read')` → `handle.read()` → **解码后的 `SessionEvent[]`**（packed 行已展开、撕尾帧不返回） | handle 接缝，首选路径 |

**运行时探查而非版本判定**：每次汇总请求先试 `open`（seam 线），缺 `open` 再试 `supportsRawArtifacts`/`readRaw`（发布线）——同一个 bundle 在两条线上都给出完整会话账本，浏览器端无需改动。两条线都不可用（旧版 host 或后端不支持原始导出）时静默降级为本地尾窗折叠，**不报错但金额偏小**。注意：handle 接缝目前**只存在于 master 主线**，`0.1.2-alpha.4`、`0.1.2-alpha.5`、`0.1.2-rc.1` 的**实际发布内容**都还是 `readRaw` 面——本包按实际发布物判断，而非按版本号时间线。

浏览器端契约在 alpha.2 → alpha.5 → rc.1 → 当前 master 之间无破坏性变化（`conversation.composer.dock` 的 owner 份额在 alpha.2→alpha.5 间被移走，本包未使用该份额，无需改动）；本包 devDeps 钉在 `0.1.2-rc.1`（当前 npm 发布线与 master 的客户端契约一致）。

## 与现有同类插件的差异

RoxsLee/dsh-cost-plugin（峰谷按时间戳+余额）、Lzh3070/dsh-session-cost（逐消息+明细+余额）等已覆盖「统计行旁读金额」。本项目差异化：

1. 事件级 last-wins 与统计行账目逐笔对齐（防 chunk/终值重复计费）；
2. 低峰+缓存节省分解与峰/谷当前状态徽标；
3. 未知模型不猜价、显示「价格未知」；
4. 纯函数核心（window/price/fold/cost）独立可测，价目与窗口规则全量配置化。

## Known Limitations and Deferred Work

- **读数是"全量"且零窗口成本**：会话总账由 **host 端从持久化日志折叠**（master 线 `sessionPersistence.open(id, 'read')` → `handle.read()` 取**解码后的逻辑事件流**；发布线经 `readRaw` 文本回退解析，同价目同规则），客户端**永不翻页**——客户端窗口从不膨胀，会话二次进入零额外成本（补齐了纯客户端窗口方案的短板）。每次轮次结算 host 重读一次该会话日志（大日志的 host 侧成本，后续可加 revision 缓存）。
- **今日(DSH)**：host 端跨所有会话按北京时间今日边界汇总（同口径=主对话调用）；与官方控制台差异（标题/压缩等隐性调用）依旧体现在"今日"之外。
- **「当前高峰/低谷」徽标按组件渲染时刻计算**——会话空闲时不会自动翻牌（下一次事件驱动重渲染时更新）。后续可改为定时刷新。
- **不含压缩总结/标题生成/子代理**——这些调用在官方口径下同样计费；未来以配置开关引入（`includeCompaction` / `includeTitleGen` / `includeSubagents`）。
- **默认价目为 2026-08-28 采集**——官方再次调价后需同步更新 `price.ts`（或提供自定义价目配置通道，待接入 DSH 配置系统）。
- **余额/今日 = host 端能力**：需要 Vite 同源 `/_dsh-cost/summary` 路由（本包 host 半）与 DSH 配置的 `DEEPSEEK_API_KEY`；未配置/失败时余额段静默隐藏（其余功能不受影响）。
- 本插件仅按模型单价估算，**不构成官方账单**；对账以 DeepSeek 控制台为准。
