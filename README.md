# dsh-ui-tools

DeepSeek Harness (dsh) web 插件 —— 一个开发者工具面板,功能移植自 [pi-web-ui](https://github.com/xing-shuyin/pi-web-ui):

1. **项目文件查看器** —— 跟随工作区/会话自动切换,新会话自动显示。目录树懒加载、点击文件预览/编辑、Markdown 自动渲染预览可切换源码、可把文件/选中行「提及」到输入框(随问题一起发送,而不是在输入框里 @ 文件)。
2. **终端** —— 支持多个终端标签页;自定义快捷命令(名称 / 命令 / 运行目录,持久化到 `<工作区>/.dsh-ui-tools/commands.json`,`${pwd}` 会展开为会话工作区)。
3. **Git 面板** —— 更改列表(暂存/未暂存/未跟踪)、文件差异、提交历史、commit / push / pull / 切换分支(写操作在终端标签页中运行,可实时查看输出)。

## 结构

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

## 构建

```bash
npm install        # 需要允许 esbuild / node-pty 的安装脚本
npm run build      # 生成 client/client.js
```

## 安装到 dsh web

```bash
# 1. 构建插件(见上)
cd /Volumes/P/project/dsh-ui-tools && npm run build

# 2. 把插件装进 web profile(等价于在 ~/.dsh/profiles/web 里执行 pnpm add)
dsh plugin --profile web add /Volumes/P/project/dsh-ui-tools
```

3. 编辑 `~/.dsh/profiles/web/package.json`,把 `dsh-ui-tools` 加进 `dsh.profile.bundles` 列表(排在已有 bundle 之后):

```json
{
  "dependencies": {
    "dsh-ui-tools": "link:/Volumes/P/project/dsh-ui-tools"
  },
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

4. 重启 `dsh web`。刷新页面后:

- 会话标题栏右侧出现 **📁 文件 / 🖥️ 终端 / ⑂ Git** 按钮,右侧浮出工具面板(默认展开);
- 文件标签页列出当前工作区文件树,点文件预览/编辑,点「＋」把文件加入输入框上方的提及条;
- 发送问题时,提及的文件内容会自动随消息一起发送给 Agent(由 Host 在 `agent/pre-step` 时把文件内容拼进用户消息,随后清空提及)。

> 注意:终端使用 `node-pty` 在 dsh 进程内直接启动 shell,不经过 dsh 的沙箱 —— 与 pi-web-ui 一致。

## 与 pi-web-ui 的对应关系

| 本插件 | pi-web-ui 来源 |
| --- | --- |
| `dsh/index.js` 终端管理 | `server/terminals.ts`(node-pty + 命令文件) |
| `dsh/index.js` 文件读写/预览分类 | `server/agent-service.ts`(readFile / listFiles / hexDump / workspacePath) |
| `client/src/TerminalView.tsx` | `web/src/components/TerminalPanel.tsx` + `TermXterm.tsx` |
| `client/src/GitView.tsx` + `git-parse.ts` | `web/src/components/SCMPanel.tsx` |
| `client/src/FilesView.tsx` + `FilePreview.tsx` | `web/src/components/RightPanel.tsx` + `FilePreview.tsx` |
| 提及(随问题发送) | pi-web-ui 的 attachment(`inline` / `reference` / `lines`) |
