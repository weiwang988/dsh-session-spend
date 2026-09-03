# 集成全流程：dsh-session-spend → deepseek-harness（Web GUI）

> 从源码检出到 GUI 里看到 ¥ 读数的完整链路，含每条命令与验证点。
> 前提：Windows/macOS/Linux 均可；`node ≥ 20`、`pnpm`、`dsh` CLI 在 PATH 上；能访问 npm registry（首次构建需拉 `@deepseek-ai/*` peer 包）。

## 阶段草图（先看全局）

```
[源码 D:\Projects\dsh\dsh-session-spend]
   │  pnpm install + build (tsdown)
   ▼
[lib/ 产物]  lib/client.js + lib/index.js + lib/types/ + cordis.patch.yml
   │  dsh plugin --profile web add .
   ▼
[$DSH_HOME\profiles\web\]  pnpm link 检出目录 + dsh.profile.bundles 追加
   │  dsh web（启动加载器合成配置树）
   ▼
[加载器]  patch 行 {id: session-spend, name: dsh-session-spend} 进入组合
   │  client-modules 扫描组合行 → 读本包 dsh.client 清单 → 解析 exports["./client"]
   ▼
[服务端]  /plugins/session-spend/client.js serve + window.__DSH_BOOT__ 清单注入
   │  浏览器加载页面
   ▼
[浏览器]  fetch 插件 bundle → cordis 客户端运行时激活 apply()
   │  注册：locale + conversation 定义 + 'cost' 视图 + dock 条目
   ▼
[GUI]  统计行横带出现「¥0.11 · 高峰中」，悬停见分解
```

---

## 阶段 1 · 构建插件（源码检出 → lib/ 产物）

```powershell
cd D:\Projects\dsh\dsh-session-spend

# 1. 安装开发依赖（@deepseek-ai/dsh-client-* 钉在 0.1.2-rc.1，与当前 npm 发布线
#    及 host master 主线契约一致；含契约 pull 包 dsh-api-session-controller、dsh-client-ui-session、
#    dsh-client-ui-settings、dsh-client-ui-settings-plugins、dsh-client-ui-renderer、
#    dsh-client-store——它们声明浏览器端 Context/slot/locale 的 merge，真实类型
#    检查必须安装；host 半对 sessionPersistence/webServer/credentials 采用结构
#    duck typing，devDeps 无需任何 host 包）
pnpm install

# 2. 构建（tsdown 产出 lib/client.js、lib/index.js、lib/types/）
#    注意：tsdown 0.22 默认产 .mjs、outDir 默认 dist——本包 tsdown.config.ts
#    已固定 outDir: 'lib' + outExtensions: () => ({ js: '.js', dts: '.d.ts' })，
#    产物命名与 package.json exports 严格一致，不要改动这两项。
pnpm run build

# 3.（可选）自检
npm test                   # 38 个单测
npm run typecheck          # 真实类型检查（依赖上面的契约 pull 包）
npm run typecheck:offline  # 镜像类型检查（需 types/ 镜像，离线可用）
```

**验证**：`Test-Path lib/client.js` 应为 `True`；`lib/client.js` 是浏览器 closure-factory bundle（约 24 KB，官方插件格式），内容含 `conversation.composer.dock` 字样。

## 阶段 2 · 安装进 web profile（产物 → $DSH_HOME）

```powershell
# 在检出目录内运行（相对路径以调用目录锚定，add . 装的正是这个检出）
dsh plugin --profile web add .
```

这步做的事（官方机制）：
1. profile 缺失则按模板初始化（`web` 模板 = base + web-app 两个内置 bundle）；
2. pnpm 在 `$DSH_HOME\profiles\web\node_modules\dsh-session-spend` 放**符号链接**指向检出目录（本地改动实时生效，但内容是 lib/ 产物）；
3. 读检出目录 `package.json` 的 `dsh.bundle.patch` → 把 `dsh-session-spend` 追加进 `dsh.profile.bundles`。

**验证**：
```powershell
Get-Content "$env:USERPROFILE\.dsh\profiles\web\package.json"   # bundles 数组应含 dsh-session-spend
dsh --profile web --dump-config | Select-String session-spend    # 应见 "# == dsh-session-spend" 层与插件行
```

## 阶段 3 · 启动与浏览器接线（profile → GUI）

```powershell
dsh web        # = dsh --profile web；默认 http://127.0.0.1:3080
```

启动时序（你不需要操作，但要知道出错在哪一环）：
1. 加载器按层序合成配置树：`@deepseek-ai/dsh-base` → `@deepseek-ai/dsh-web-app` → `dsh-session-spend`（我们）→ profile 自身 patch → `$DSH_HOME\cordis.patch.yml` → `--patch`；
2. `client-modules`（`@deepseek-ai/dsh-client-modules`）扫描**插件行**：发现 `dsh.client` 清单 → 解析 `exports["./client"]` → 生成 `window.__DSH_BOOT__` 插件图 → 在 `/plugins/session-spend/client.js` 提供 bundle；
3. 浏览器打开页面 → 按清单拉取插件 bundle → cordis 客户端运行时激活 `apply()` → 注册 locale 词典、`conversationEvents` 定义、`conversationViews` 'cost' 目标、`conversation.composer.dock` 条目。

**验证（浏览器 DevTools）**：
- Network 面板应见 `/plugins/session-spend/client.js` 200；
- Console 无 `client-modules` 相关报错（有报错先看"故障排查"）。

## 阶段 4 · 功能验证（数据流按事件走，非轮询）

数据流：host 会话日志 → `session/event` 帧（`assistant/message` 带 usage + 时间戳）→ 客户端 Session → Definition 引擎逐事件建 Context → 'cost' view 折叠 → 快照 → dock 条目渲染。

**验证清单**：
1. 新会话发一条消息，结算后统计行旁出现 `¥0.xx · 高峰中/低谷中`；
2. 悬停：总计 / 低峰节省 / 缓存节省 / 模型分解 /（如有）价格未知；
3. 中途切 `deepseek-v4-pro` 再跑一轮 → 模型分解出现两行（flash + pro）；
4. 对照统计行 token 数字手算一次金额（公式：`cacheRead×命中价 + (未缓存+写入)×未命中价 + 输出×输出价`，除以 1e6 × 100 万 token 单价，按每笔时刻的峰/谷价）；
5. 刷新页面、切到历史会话 → 读数由事件重放重建，结果不变（**不重复计费**）；
6. 北京时间工作时段 9:00–12:00 / 14:00–18:00 外 → 徽标「低谷中」且同流量金额为高峰的一半。

## 阶段 5 · 开发迭代循环

| 改动 | 操作 | 结果 |
|---|---|---|
| `src/**` 逻辑/UI | `pnpm run build` → **刷新浏览器** | 服务端 serve `lib/client.js`（每次 build 后 rev 变化，刷新即取新包） |
| `src/index.ts`（host 半，服务端代码） | `pnpm run build` 后**重启 `dsh web`** | host 半随进程加载；不重启则旧代码继续跑 |
| `cordis.patch.yml` / `package.json`（清单） | build 后**重启 `dsh web`** | 组合/清单变更只在启动时扫描 |
| 想走 HMR | 在 harness 检出跑 `pnpm run dev:web`（独立 watcher），浏览器自动热更 | 仅开发期，需要 concurrent dev 环境 |

注意：`dsh web` 一次启动后，新增插件行要求重启服务端才能进入 `__DSH_BOOT__`；纯 bundle 内容变更只需刷新。

## 阶段 6 · 分发（让别人也能装）

```powershell
# A. npm 发布（prepare 自动构建，用户在任意机器）—— 推荐
npm publish                                  # 或 pnpm publish
# 用户侧：dsh plugin --profile web add dsh-session-spend

# B. tarball 分发（免构建许可）
pnpm pack                                    # 产出 dsh-session-spend-0.1.0.tgz
# 用户侧：dsh plugin --profile web add ./dsh-session-spend-0.1.0.tgz

# C. git 安装（需要允许构建）
dsh plugin --profile web add github:you/dsh-session-spend#<commit-sha>
# 首次失败时按提示在 profile 的 pnpm-workspace.yaml 写入 allowBuilds: dsh-session-spend: true 后重试
```

卸载：`dsh plugin --profile web remove dsh-session-spend`。

---

## 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| `ERR_PNPM_FETCH_404 ... @deepseek-ai/dsh-compact` | pnpm 把 peer `"*"` 解析到**远古版本**（如 `@deepseek-ai/dsh-client-runtime@0.0.1-rc.1`），旧清单引用了改名前的未发布包名 `dsh-compact`（对照：官方包名是 `dsh-compaction`，两源均 404 确认从未发布） | ① `Remove-Item -Recurse -Force node_modules, pnpm-lock.yaml` ② 重装（本包按官方 0.1.2 模式**只声明 cordis 一个 peer**，已无 peer 级联；所有 `@deepseek-ai/dsh-client-*` devDeps 钉在精确 `0.1.2-rc.1`）③ 若镜像缺包：`pnpm config set @deepseek-ai:registry https://registry.npmjs.org/` 后重装 |
| `client-modules: ...exports no "./client" bundle` | 没 build 就 add（或 git 安装没跑 prepare） | `pnpm run build` 后重启 `dsh web` |
| `dsh plugin add` git 安装被拒 | pnpm ≥10 默认不执行 git 依赖的 prepare | profile `pnpm-workspace.yaml` 加 `allowBuilds`；或改 tarball/npm |
| 页面无读数、console 报 inject 服务缺 | 缺 `web-app` bundle（profile 没 web 模板） | 确认 `dsh --profile web --dump-config` 中有 web 层；必要时重加 `@deepseek-ai/dsh-web-app` |
| 有事件但金额不涨 | 用了未配置价目的模型 | 显示「价格未知」属预期；在价目表补该模型或换官方模型 |
| 徽标与本地直觉不符 | 官方峰谷按**北京时间**判定（本插件硬编码 Asia/Shanghai） | 属正确行为；本地时区不用改 |
| 升级 DSH 后读数只剩尾窗小额、无「今日」 | 持久化面探不到（既无 `open` 也无 `readRaw`；旧版 host 或后端不支持原始导出） | `pnpm install && pnpm run build` 后重启 `dsh web`；本包已做双线适配：master 线的 `open/read/close` handle 接缝 + 已发布 0.1.2 线的 `readRaw` 文本回退（跳过格式头行与 packed chunk 行，同价目同规则折叠） |
| peer 版本不匹配警告 | profile 侧重置了 `@deepseek-ai/dsh-client-*` 新版本 | 保持本包 peer 为 `*`；以 `dsh` 自带的运行时为准，异常时 `dsh plugin --profile web update` |
| 装了但统计行位置异样 | dock 多条目布局 | 已知项；后续版本如需可换展示位 |

## 里程碑（推荐加进你的发布清单）

1. `pnpm install && pnpm run build && npm test` 全绿；
2. `dsh plugin --profile web add .` 后 `--dump-config` 见层；
3. GUI 实机对照（阶段 4 清单 1-6）；
4. `pnpm pack` + README 安装段完整；
5. 发布：npm publish 或 GitHub（pin commit）。
