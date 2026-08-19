# AGENTS.md — dsh-ui-tools

> 给 AI 代理（Claude / Cursor / pi 等）看的项目地图。改动前先读本文件，尤其是
> 「架构要点与坑」一节——里面记录了多个反直觉的设计约束。

## 项目是什么

dsh-ui-tools 是 **DeepSeek Harness（dsh）web** 的插件：在对话页右侧嵌入一个开发者
工具面板，提供 **文件浏览/预览/提及、多终端、Git、后台服务、设置（行内标记/声音）**
五个 tab。样式与功能 1:1 移植自 [pi-web-ui](https://github.com/xing-shuyin/pi-web-ui)
（本仓库内简称 "pi-web-ui"），已发布 npm `dsh-ui-tools`。

- 插件结构：**双半**——宿主端（Node，跑在 dsh 进程内）+ 客户端（React，esbuild 打成单文件）。
- 宿主端 `dsh/index.js` 是包根导出；客户端产物 `client/client.js` 走
  `window.__ModuleLoader__.load({ id, factory })` 协议被 dsh web shell 加载。
- 关键外部依赖：`node-pty`（终端）、`@xterm/xterm` + `@xterm/addon-fit`（客户端渲染）。

## 目录结构

```
dsh-ui-tools/
├── package.json          # 插件清单（dsh.bundle.patch / dsh.client 元数据）
├── cordis.patch.yml      # bundle 层：把插件插入 profile 的 layer 栈
├── dsh/                  # 宿主端（Node ESM，apply(ctx) 插件格式）
│   ├── index.js          # 入口：HTTP 路由 + TerminalManager(node-pty) + git + 提及注入
│   ├── background-servers.js  # 后台服务检测：tools/execute 前后端口 diff
│   └── marker-todo.js    # 通用内联标记系统(发布 inlineMarkers 服务) + todo 接管
├── client/
│   ├── src/              # 客户端 TSX 源码（esbuild 打包）
│   ├── client.js         # 构建产物（git 跟踪、随包发布）
│   └── bundle-body.js    # 中间产物（gitignore）
├── examples/inline-note/ # 第三方内联标记工具官方示例
├── scripts/build-client.mjs
└── shots/                # README 截图
```

## 宿主端（dsh/）

### dsh/index.js — 插件入口

`export function apply(ctx)`，职责：

- **HTTP 路由**：通过 `ctx.inject(['webServer'], cb)` 注册前缀 `/dsh-ui-tools`
  的 handler（`handleRequest`），全部 API 见下。注意：**webServer 是 scoped 服务，
  插件自己的 ctx 用 `ctx.get('webServer')` 拿不到**，必须用 `ctx.inject` 闭包形式
  （index.js 里注释说明了这一点，与 modlens 同款问题）。
- **TerminalManager**（`class TerminalManager`，端口 415 起）：每个 tab 一个
  node-pty PTY；SSE（`/stream`）推流、POST `input|resize|signal|heartbeat`。
  GC：**无 SSE 连接且 60s 无 heartbeat 的终端被杀掉**（15s 扫一次）。
  终端在 dsh 进程内直接 spawn shell，不经过沙箱（README 有安全提示）。
- **Git**：读操作（status/branch/log/diff）`execFile` 直跑；**写操作
  （commit/push/pull/checkout）不在宿主执行，而是开一个可见的终端 tab 跑命令**
  （客户端 GitView 通过 termStore.addTab 加 tab 并切到终端 tab）。
- **文件提及注入**：`ctx.on('agent/pre-step')` 在用户消息进入 agent 前，把
  「每个提及文件一条、只含路径的引用消息」插到用户消息前面（`source.kind='plugin'`
  防止再次富化；`enrichedIds` 防重复，>10000 清空）。**不附加文件内容**——agent 自己
  用 read 工具按需读，省 token。
- **node-pty spawn-helper 权限修复**：启动时检查/修复 `spawn-helper` 可执行位
  （macOS 安装后可能没 +x）。

### dsh/background-servers.js — 后台服务检测

- hook `tools/execute` 的 bash/pwsh（`ctx.on('tools/execute', ..., true)` prepend，
  waterfall 环绕 `await next()`）：执行前快照 LISTENING 端口，完成后 1.5s 再快照，
  diff 出新监听的端口 → 记录 `{ port, pid, since, name? }`（跨会话存活的插件级全局 Map）。
- 每 30s prune：端口 + pid 双匹配，进程退出自动移除。
- kill：`killPidTree`（POSIX `process.kill(-pid)`；Windows `taskkill /F /T`）。
- 与 todo 完全独立，只管「真实运行的服务」。

### dsh/marker-todo.js — 行内标记 + todo 接管

- 解析 assistant 消息正文里的 `[[tool:op:args]]` 标记（`TOKEN_RE`），按注册表分发；
  **反引号/代码块内的标记不执行**（先做等长掩码再匹配）；`[[` 嵌套防御。
- 通用注册表以 Cordis Service **`inlineMarkers`** 发布（`ctx.provide`），第三方
  bundle 用 `inject: ['inlineMarkers']` + `ctx.inlineMarkers.register(name, { applyOp })`
  注册新标记（见 examples/inline-note/）。
- todo 功能：原生 `todo_write` 工具被 `tools.restrict({ deny: ['todo_write'] })` 隐藏；
  `tools/execute` 环绕兜底旧调用；持久化沿用原生 `todo/write` 事件（`data.todos` 原生
  投影 + `data.marker` 内嵌富状态）；只读查询 `markers_list` 工具；系统提示指引
  （order 150）。**写入前必须做无损 JSON 清洗**（Session.append 拒绝 undefined/BigInt
  等，见文件头「序列化约束」）。
- 设置：`createMarkerController(ctx)`（宿主端 `~/.dsh-ui-tools/settings.json`）——
  全局总闸 + 插件级开关，运行时切换即时生效。

## 客户端（client/src/）

- **`index.tsx`** — 客户端入口 `apply(ctx)`：注入 `<style>`（pluginCss + xtermCss，
  卸载时移除）；`initLayoutControl()`；`replaceSessionLogLabel()`；`initThemeWatch()`；
  注册 slots：
  - `details`（priority -1）→ `<Panel>`（右侧面板本体，阴影掉内置 DetailsPanel）
  - `conversation.input.dock` ×2 → MentionStrip（order 30）、SoundWatcher（order 20）
- **`Panel.tsx`** — 面板外壳：5 个 tab（文件/终端/Git/任务/设置）+ 收起/悬浮重开 +
  左缘拖拽调宽（`setDetailsWidth`）。所有视图常驻挂载、CSS 隐藏（保终端回滚/文件树状态）。
- **`store.ts`** — 模块级 observable 仓库（panel tab / terminal tabs / mentions），
  **不是 React state**——因为 slots 按会话独立挂载/卸载。`termStore.addTab` 自动激活新
  tab（Git tab 写操作依赖此行为）；`nextTitle()` 生成 `终端 N`。
- **`api.ts`** — 类型化 fetch 封装 + `rawUrl`/`encodeCwd`。
- **`layout.ts`** — 右侧列宽控制：**shipped layout controller 不可靠**，所以直接用 CSS
  `!important` 覆盖布局 frame 的 inline `grid-template-columns`，用两个 CSS 变量驱动：
  `--ut-sidebar-px`（MutationObserver 从 frame inline style 同步）+ `--ut-details-px`
  （打开=宽度 px，收起=0px，localStorage 持久化）。frame 选择器：唯一带 inline
  `grid-template-columns` 的 div，找不到会重试 60 次×500ms。
- **`theme.ts`** — 观察 `body[data-ds-dark-theme]` 属性增删（MutationObserver），
  给需要 JS 读色的 xterm 配色提供 observable；CSS 层全部走 `--dsw-alias-*` token 无需 JS。
- **视图组件**：
  - `FilesView.tsx` — 面包屑 + 扁平文件列表 + 工作区切换器
  - `FilePreview.tsx` — 预览弹窗（行号/行选择/编辑 Ctrl+S/Markdown 渲染切换/hex/媒体）
  - `TerminalView.tsx` — 快捷命令条 + 终端 tab 条 + xterm（一个 tab 一个实例，隐藏的
    保持挂载）；「切换进终端 tab 且无终端」时自动新建（`active && tabs.length === 0`）
  - `GitView.tsx` + `git-parse.ts` — Git 面板 + 输出解析器
  - `JobsView.tsx` — 后台服务列表（5s 轮询）
  - `SettingsView.tsx` + `SoundSettings.tsx` — marker 开关 / 声音设置
  - `MentionStrip.tsx` — 输入框上方提及条；`SoundWatcher.tsx` — 事件边界播提示音
- **`sounds.ts`** — Web Audio API 合成提示音（无音频文件），设置存 localStorage。
- **`markdown.ts`** — 零依赖迷你 Markdown 渲染器（先 escape 再变换，无裸 HTML）。
- **`shell-labels.ts`** — MutationObserver 把硬编码的 "Session log" 文案改成 "log"
  （locale override 够不到硬编码叶子文本）。
- **`icons.tsx`** — 手写 Feather 风格内联 SVG（对应 pi-web-ui 的 react-icons/fi）。

## 客户端 API 路由总览（宿主端，前缀 /dsh-ui-tools/api）

| 路由 | 用途 |
| --- | --- |
| GET `/files` `/file` `/raw` POST `/file` | 文件浏览 / 预览（文本/hex/媒体元信息）/ 下载 / 保存 |
| POST `/terminal`、GET `/terminal/:id/stream`、POST `.../input\|resize\|signal\|heartbeat`、DELETE `/terminal` | 终端生命周期 + SSE + 输入/尺寸/信号/心跳/清理 |
| GET/POST `/commands` | 工作区快捷命令（`.dsh-ui-tools/commands.json`，`${pwd}` 展开） |
| POST `/git/query` | Git 读操作（status/branch/log/diff 统一入口） |
| GET `/background-servers`、POST `.../kill`、`.../kill-all` | 后台服务 |
| GET/POST `/settings` | marker 全局设置（`~/.dsh-ui-tools/settings.json`） |
| GET `/mentions`、POST `/mentions` | 提及列表随会话同步到宿主端 |
| POST `/jobs/kill`、`/jobs/kill-all` | 任务（复用宿主 jobs 服务，session 自己的 agent 调用才过权限） |

## 构建 / 部署 / 验证（重要）

```bash
npm install     # 需允许 esbuild / node-pty 安装脚本
npm run build   # scripts/build-client.mjs：esbuild 打包 → client/client.js
```

- 打包细节：react / react/jsx-runtime **保持 external**（对 dsh module-loader 的
  seed table 解析）；CSS 用 `loader: { '.css': 'text' }` 内联为字符串、由插件在
  apply 时注入 `<style>`；`define` 掉 `process.env.NODE_ENV`。
- **本地开发验证**：`dsh web` 实例装在 `~/.dsh/profiles/web/node_modules/dsh-ui-tools/`
  是**拷贝不是符号链接**——改完客户端必须 `npm run build` 后把新 `client/client.js`
  **手动 cp 过去**，再刷新浏览器页面；改宿主端（dsh/*.js）需要**重启 `dsh web` 进程**。
- 本机开发环境：dsh web → `http://localhost:3080`；pi-web-ui 的 dev server → 5173/8788
  （对照参考实现用）。
- 发布：npm 包（`dsh plugin --profile web add dsh-ui-tools` 安装）。

## 架构要点与坑（改动前必读）

1. **scoped 服务拿不到**：webServer / tools / systemPrompt / agents / jobs 都在
   scoped 层，`ctx.get` 看不到；宿主端一律用 `ctx.inject([...], cb)` 闭包形式。
2. **客户端状态在模块级 store，不在 React**：slots 按会话挂载/卸载，任何视图都可能被
   卸载重挂，跨组件共享状态必须走 `store.ts` 的 observable（`useSyncExternalStore`）。
3. **主题只读 CSS token**：面板颜色一律 `var(--dsw-alias-*, fallback)`，跟随
   `body[data-ds-dark-theme]` 自动级联；只有 xterm 画布配色需要 JS（`theme.ts`）。
4. **终端尺寸**：xterm 用 `FitAddon`，`fit()` 取 xterm **父元素**的 computed 高度并只减
   xterm 自身 padding——所以**终端容器自身不能有 padding**（历史上 `.term-xterm` 带
   padding 导致最底行被裁切，已修复：padding 挪到 `.term-main`）。以后动终端布局，
   保持「fit 测量的元素无 padding」这条规则。
5. **终端 GC**：无 SSE 连接 + 60s 无心跳会被宿主杀；客户端断开连接要尽快发 DELETE。
6. **Git 写操作走可见终端**，不要直接 execFile 执行 commit/push/pull。
7. **提及注入**：`agent/pre-step` 里找「第一个未富化的真实 user 消息」
   （`!source || source.kind === 'user'`），引用消息必须带 `source.kind='plugin'` 防循环。
8. **内联标记**：解析发生在 assistant 消息落库后；代码块/反引号里的标记不会执行；
   失败标记留在原文等下轮修正，**不要剥除标记文本**（会破坏 provider 缓存）。
9. **路径安全**：文件 API 一律过 `workspacePath()`（拒绝 `..` 穿越）。
10. **node-pty spawn-helper**：macOS 下可能缺可执行位，index.js 有修复逻辑，别删。
11. **窄布局**：终端/Git 在面板窄时（`panelWidth < 520`，Panel 传 `narrow`）切换为
    上下堆叠布局。

## 与 pi-web-ui 的对应关系（移植/对照查实现）

| 本插件 | pi-web-ui 来源 |
| --- | --- |
| `dsh/index.js` 终端管理 | `server/terminals.ts` |
| `dsh/index.js` 文件读写/预览 | `server/agent-service.ts` |
| `TerminalView.tsx` | `web/src/components/TerminalPanel.tsx` + `TermXterm.tsx` |
| `GitView.tsx` + `git-parse.ts` | `web/src/components/SCMPanel.tsx` |
| `FilesView.tsx` + `FilePreview.tsx` | `web/src/components/RightPanel.tsx` + `FilePreview.tsx` |
| 提及 | pi-web-ui 的 attachment（inline/reference/lines） |
| `sounds.ts` + `SoundSettings.tsx` | `web/src/sounds.ts` + `SoundSettings.tsx` |
| 后台服务 | pi-web-ui 的后台任务（port diff） |

## 工程约定

- **注释/README 用中文**，commit message 前缀 `feat:` / `fix:` / `style:` / `docs:` /
  `chore:`（看 git log 保持风格）。
- `.dsh-ui-tools/commands.json` 是运行时工作区数据（gitignore，别提交）；改它要确认是
  用户操作产生的还是你误触的（保存命令会整文件覆写）。
- `~/.dsh-ui-tools/settings.json` 是宿主端全局设置（marker 开关），跨工作区。
- 终端里的 `终端 N` 标题由 `termStore.nextTitle()` 生成；Git 写操作用命令名做 tab
  标题，重跑会**替换同名 tab**（TerminalView `runCommand`）。
- README 的「项目结构 / 对应关系」两节与本文件同源，改架构记得同步。

## 验证 checklist（改完自测）

- 客户端改动：`npm run build` → cp 到 `~/.dsh/profiles/web/node_modules/dsh-ui-tools/client/`
  → 浏览器刷新 → 冒烟（面板展开/收起、5 个 tab、终端新建/输入/多 tab 切换、文件
  预览/提及、Git 面板）。
- 宿主端改动：重启 `dsh web` → 同上冒烟。
- 终端布局改动：分别验证 1 个 / 多个终端 tab 下最底行完整可见（历史 bug：底部裁切）。
- 主题改动：亮/暗/跟随系统三种模式各看一眼面板和终端配色。
