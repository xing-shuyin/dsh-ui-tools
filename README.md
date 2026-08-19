# 🛠️ dsh-ui-tools

> DeepSeek Harness (dsh) web 开发者工具面板 —— 文件浏览 / 多终端 / Git / 后台任务,样式 1:1 移植 [pi-web-ui](https://github.com/xing-shuyin/pi-web-ui)。

<p>
<a href="https://www.npmjs.com/package/dsh-ui-tools"><img alt="npm" src="https://img.shields.io/npm/v/dsh-ui-tools"></a>
<a href="https://github.com/xing-shuyin/dsh-ui-tools"><img alt="GitHub" src="https://img.shields.io/github/stars/xing-shuyin/dsh-ui-tools?style=social"></a>
<img alt="license" src="https://img.shields.io/github/license/xing-shuyin/dsh-ui-tools">
</p>

---

## ✨ 功能总览

右侧嵌入对话页的开发者工具面板,默认展开、**可拖拽调整宽度(360–900px)、可收起**;所有视图随当前工作区/会话自动切换。

### 📁 项目文件查看器

- 跟随会话工作区自动切换,新会话自动显示;
- 面包屑导航浏览目录,**不截断文件列表**,全部显示;
- 点击文件弹出预览:行号视图、选择行、**Markdown 自动渲染(可一键切换源码)**、图片/视频、二进制 hex;
- 编辑保存(Ctrl/Cmd+S);下载任意文件;
- **文件提及(智能引用)**:在文件预览里点「＋」把文件/文件夹/选中行一键加入提及条(与输入框自动对齐),发送问题时引用**自动作为独立消息随问题发出** —— 无需在输入框里 @ 文件,随手引用、即发即用;
- **轻量路径引用**:引用只携带文件路径,**不把整份文件内容塞进上下文** —— 更省 token、上下文更干净,Agent 需要时用 read 工具按需精准读取,和 Claude Code / Cursor 等专业 Agent 的引用体验一致。

### 🖥️ 多终端

- 多个终端标签页,每个独立 PTY(node-pty),SSE 实时推流;
- 顶部一栏两列:快捷命令 + 终端标签,可横向滚动、竖向列表,命令 chip 直接点击运行;
- **自定义快捷命令**:名称 / 命令 / 运行目录均可编辑,持久化到 `<工作区>/.dsh-ui-tools/commands.json`,`${pwd}` 自动展开为会话工作区;
- 切换终端标签且无终端时自动新建。

### ⑂ Git 面板

- 更改列表(暂存 / 未暂存 / 未跟踪)+ 行级增删统计;
- 点击文件查看差异(暂存/未暂存分开展示);
- 提交历史(带 graph 分支图)与提交详情;
- commit、push、pull、分支下拉切换 —— 写操作在终端标签页中运行,可实时查看输出。

### ⏳ 后台任务

- 列出当前会话的后台任务(状态、kind、详情);
- 单个任务关闭、一键全部关闭。

### ✍️ 行内标记任务列表(替换 todo_write)

参照 [pi-marker-tools](https://github.com/xing-shuyin/pi-marker-tools),把模型侧的 `todo_write` 工具替换为「写在回答正文里的 `[[todo:...]]` 行内标记」:

- 状态类操作不再调用工具,直接在回复正文写标记,插件在消息结束时自动解析、执行、落库,不会中断回答 —— 少几轮工具调用问答往返,全部由 AI 回答内部实现管理;
- 标记语法:`[[todo:new:写单元测试]]` 新建、`[[todo:set:2,completed]]` 改状态、`[[todo:remove:2]]` 删除、`[[todo:dep:2,blocks=1,3]]` 声明依赖、`[[todo:title:2:新标题]]` 重命名;
- 富状态(带 id)内嵌进原生 `todo/write` 事件持久化(随分支跟随,resume 恢复;旧日志兼容读取 `marker/todos` 快照) —— 现有 TodoDock 任务条零改动直接生效;
- 面板新增「设置」tab:两级开关控制 marker 功能 —— 全局总闸(停用整个内联标记框架、恢复原生 `todo_write` 工具、不再解析标记)+ 每个内联标记插件独立开关(如 `todo`,停用后该插件的标记不再执行、恢复原生行为,其他插件不受影响;第三方注册的插件也会出现在列表里)。切换即时生效,持久化到 `~/.dsh-ui-tools/settings.json`,对所有工作区生效;
- 只读查询走 `markers_list` 工具;`todo_write` 已从模型可见工具中移除(不会出现 unknown tool 提示),旧调用也会被本插件接管、绝不报错;
- 与 pi-marker-tools 一致:标记文本保留在消息原文,执行失败的标记留待下轮修正;
- 解析器跳过反引号/代码块内的标记(文档示例不会误执行),`[[todo:title:<id>:<新标题>]]` 支持冒号语法,持久化前做无损 JSON 清洗(杜绝 exotic 值导致 `todo/write` 写入失败)。

### 🧩 第三方扩展:注册自己的内联标记工具

通用内联标记系统以 **Cordis Service `inlineMarkers`** 发布 —— 任何 dsh bundle 插件都能用官方格式注册新的 `[[tool:...]]` 标记,与内置 `todo` 完全同权(解析、持久化、错误处理一致):

```js
// 你的插件 dsh/index.js(官方 bundle 插件格式)
export const name = 'my-inline-tool'
export const inject = ['inlineMarkers']

export function apply(ctx) {
  ctx.inlineMarkers.register('note', {
    // state: 当前会话共享富状态(含 todo 的 tasks/nextId,JSON 安全字段自动透传持久化)
    // token: { tool, op, args, kwargs, raw }
    applyOp(state, token) {
      const text = (token.args[0] || '').trim()
      if (!text) return { applied: false, error: 'note:add 需要文本' }
      state.notes = state.notes || []
      state.notes.push({ text, at: Date.now() })
      return { applied: true, feedback: `Note added: ${text}` }
    },
  })
}
```

- `applyOp` 返回 `{ applied: true, feedback? }` 表示状态已变(触发持久化);`{ applied: false, error? }` 表示忽略(不报错、不落库);
- 注册后模型在回答正文写 `[[note:add:...]]` 即自动触发,与 `[[todo:...]]` 完全一致;
- 完整可运行示例见 [`examples/inline-note/`](examples/inline-note/),安装方式与任何 bundle 插件相同(`dsh plugin --profile web add <你的包>` 或本地路径 patch)。

### 🔊 声音提示(移植自 pi-web-ui)

- 在「提问/审批弹窗、运行完成、开始运行、出错」四个时刻播放提示音,全部由 Web Audio API 合成(无音频文件、离线可用);
- 工具面板「设置」tab 提供配置:总开关、各事件独立开关 + 试听、音量滑条,持久化到浏览器 localStorage,即时生效;
- 与 pi-web-ui 的 `sounds.ts` + `SoundSettings.tsx` 一一对应。

### 🎨 主题适配(dsh web 亮/暗/跟随系统)

- 面板调色板全部引用 dsh 主题系统的 `--dsw-alias-*` token(`body` / `body[data-ds-dark-theme]` 上定义),随 shell 的主题切换(亮/暗/跟随系统、第三方注册主题)自动级联,无需 JS 参与;
- xterm 终端通过观察 `body[data-ds-dark-theme]` 实时重绘画布配色(背景/前景/光标读 shell token,ANSI 16 色用亮暗两套调色板)。

---

## 📸 截图

| 文件面板 + 文件提及 | Git 面板 |
| --- | --- |
| ![文件面板与文件提及](https://raw.githubusercontent.com/xing-shuyin/dsh-ui-tools/main/shots/shot1.jpeg) | ![Git 面板](https://raw.githubusercontent.com/xing-shuyin/dsh-ui-tools/main/shots/shot2.jpeg) |
| 多终端(快捷命令一键运行) | 文件面板(目录浏览) |
| ![多终端](https://raw.githubusercontent.com/xing-shuyin/dsh-ui-tools/main/shots/shot3.jpeg) | ![文件面板](https://raw.githubusercontent.com/xing-shuyin/dsh-ui-tools/main/shots/shot4.jpeg) |

---

## 📦 安装(无需克隆项目)

插件已发布到 [npm](https://www.npmjs.com/package/dsh-ui-tools) 与 [GitHub](https://github.com/xing-shuyin/dsh-ui-tools):

```bash
# 从 npm 安装(推荐)
dsh plugin --profile web add dsh-ui-tools

# 或从 GitHub 安装
dsh plugin --profile web add github:xing-shuyin/dsh-ui-tools
```

把 `dsh-ui-tools` 加进 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`:

```json
{
  "dependencies": { "dsh-ui-tools": "^0.1.1" },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-ui-tools"
      ]
    }
  }
}
```

重启 `dsh web` 并刷新页面。右侧工具面板默认展开;收起后点击右侧边缘的悬浮 🛠️ 按钮即可重新打开。

> ⚠️ 注意:终端使用 `node-pty` 在 dsh 进程内直接启动 shell,不经过 dsh 的沙箱 —— 与 pi-web-ui 一致。

---

## 🔧 开发

```bash
npm install        # 需要允许 esbuild / node-pty 的安装脚本
npm run build      # 打包 client → client/client.js
```

## 📂 项目结构

```
dsh-ui-tools/
├── package.json          # 插件包清单 (dsh.bundle.patch / dsh.client)
├── cordis.patch.yml      # bundle 层:插入插件行
├── dsh/
│   ├── index.js          # Host 端:HTTP 路由 + node-pty 终端 + git + mentions 富化
│   └── marker-todo.js    # 通用内联标记系统(发布 inlineMarkers 服务)+ todo 功能
├── client/
│   ├── src/              # Client 端源码 (TSX, esbuild 打包)
│   └── client.js         # 构建产物 (window.__ModuleLoader__ 协议)
├── examples/
│   └── inline-note/      # 第三方内联标记工具示例(官方 bundle 格式)
└── scripts/build-client.mjs
```

## 🔗 与 pi-web-ui 的对应关系

| 本插件 | pi-web-ui 来源 |
| --- | --- |
| `dsh/index.js` 终端管理 | `server/terminals.ts`(node-pty + 命令文件) |
| `dsh/index.js` 文件读写/预览分类 | `server/agent-service.ts`(readFile / listFiles / hexDump / workspacePath) |
| `client/src/TerminalView.tsx` | `web/src/components/TerminalPanel.tsx` + `TermXterm.tsx` |
| `client/src/GitView.tsx` + `git-parse.ts` | `web/src/components/SCMPanel.tsx` |
| `client/src/FilesView.tsx` + `FilePreview.tsx` | `web/src/components/RightPanel.tsx` + `FilePreview.tsx` |
| 提及(随问题发送) | pi-web-ui 的 attachment(`inline` / `reference` / `lines`) |
| 声音提示(Web Audio 合成 + 设置) | `web/src/sounds.ts` + `web/src/components/SoundSettings.tsx` |

---

## 📄 License

MIT
