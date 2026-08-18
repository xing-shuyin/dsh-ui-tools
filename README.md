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
├── dsh/index.js          # Host 端:HTTP 路由 + node-pty 终端 + git + mentions 富化
├── client/
│   ├── src/              # Client 端源码 (TSX, esbuild 打包)
│   └── client.js         # 构建产物 (window.__ModuleLoader__ 协议)
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

---

## 📄 License

MIT
