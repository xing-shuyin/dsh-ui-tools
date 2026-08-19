/**
 * inline-note — 第三方内联标记工具示例（官方 dsh bundle 插件格式）。
 *
 * 展示如何通过 dsh-ui-tools 发布的 `inlineMarkers` 服务，为通用内联标记
 * 系统注册一个新的标记工具：模型在回答正文写 [[note:...]]，插件自动解析
 * 执行，不需要任何工具调用往返。
 *
 * 安装方式（与任何 bundle 插件一致）：
 *   1. 把本目录发布/拷贝为 npm 包（package.json 见下方），或直接用
 *      cordis.patch.yml 以本地路径插入：
 *
 *        - insert:
 *            - id: inline-note
 *              name: 'file:///C:/abs/path/to/inline-note/dsh/index.js'
 *
 *        注意：Windows 下 name 必须是三斜杠 file:/// URL（裸盘符路径如
 *        E:/... 会被 ESM loader 当作 scheme 而报错），详见官方文档。
 *
 *   2. 重启 dsh web。
 *
 * 用法（模型侧）：在回答正文写
 *     [[note:add:关键结论]]        → 追加一条 note
 *     [[note:clear]]               → 清空全部 notes
 *     [[note:list]]                → 无副作用（返回提示，供标记执行反馈）
 *
 * applyOp 签名：applyOp(state, token)
 *   - state：当前会话共享富状态（含 todo 的 tasks/nextId，第三方字段与
 *     todo 共存于同一 state，persist/loadState 自动透传 JSON 安全字段）
 *   - token：{ tool, op, args, kwargs, raw }
 *   - 返回：{ applied: true, feedback? } 表示状态已变（触发持久化）；
 *           { applied: false, error? } 表示忽略（不持久化、不报错）。
 */

export const name = 'inline-note'
export const inject = ['inlineMarkers']

export function apply(ctx) {
  ctx.inlineMarkers.register('note', {
    applyOp(state, token) {
      const op = token.op
      const notes = state.notes || (state.notes = [])

      if (op === 'add') {
        const text = (token.args[0] || '').trim()
        if (!text) return { applied: false, error: 'note:add 需要一个文本参数 [[note:add:<文本>]]' }
        notes.push({ text, at: Date.now() })
        return { applied: true, feedback: `Note #${notes.length} added: ${text}` }
      }

      if (op === 'clear') {
        if (notes.length === 0) return { applied: false, error: 'no notes to clear' }
        state.notes = []
        return { applied: true, feedback: `Cleared ${notes.length} notes` }
      }

      if (op === 'list') {
        if (notes.length === 0) return { applied: false, error: 'no notes yet' }
        return { applied: false, feedback: notes.map((n, i) => `${i + 1}. ${n.text}`).join('\n') }
      }

      return { applied: false, error: `note 未知操作: ${op}（add|clear|list）` }
    },
  })
}
