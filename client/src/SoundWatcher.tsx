/**
 * 声音提示监听器 — 注册在 conversation.input.dock（会话作用域），自身不渲染
 * 任何 UI（返回 null），只在事件边界播放提示音。
 *
 * 监听当前会话的 ConversationSnapshot，事件映射（对应 pi-web-ui 的四种提示音）：
 *   - start   ：会话开始运行（running false → true，即 agent 开始处理）
 *   - done    ：会话结束运行（running true → false，即一轮工作完成）
 *   - question：出现新的 pending 交互（kind 为 question / approval —
 *               ask_user_question 提问弹窗或审批请求，都需要用户介入）
 *   - error   ：lastAgentError 变为新的非空值（回合出错）
 *
 * 设置实时读取（playSound 每次调用都 loadSoundSettings），改动立即生效。
 * 首次观察不播放（避免页面加载/切换会话时的误报）；切换会话时组件随
 * 会话作用域重挂载，状态自然重置。
 */
import * as React from 'react'
import { playSound } from './sounds'

interface SoundWatcherProps {
  /** 会话标准钩子：选择 ConversationSnapshot 的字段。 */
  useSession?: (sel: (s: unknown) => unknown) => unknown
  sessionId?: string
}

interface PendingFace {
  kind?: string
  key?: string
}

export function SoundWatcher({ useSession }: SoundWatcherProps) {
  const running = useSession
    ? (useSession((s: any) => (s ? !!s.running : false)) as boolean)
    : false
  const pending = useSession
    ? (useSession((s: any) => (s ? s.pending : [])) as readonly PendingFace[])
    : []
  const lastAgentError = useSession
    ? (useSession((s: any) => (s ? s.lastAgentError : null)) as string | null)
    : null

  const prevRunning = React.useRef<boolean | null>(null)
  const seenPending = React.useRef(new Set<string>())
  const lastError = React.useRef<string | null>(null)

  // 开始 / 结束（运行边沿）
  React.useEffect(() => {
    const prev = prevRunning.current
    prevRunning.current = running
    if (prev === null) return // 首次观察 — 不播放
    if (!prev && running) playSound('start')
    else if (prev && !running) playSound('done')
  }, [running])

  // 提问 / 审批弹窗（新的 pending 交互，按 key 去重）
  React.useEffect(() => {
    for (const p of pending) {
      if (!p || (p.kind !== 'question' && p.kind !== 'approval')) continue
      const key = p.key ?? `${p.kind}:${Date.now()}`
      if (seenPending.current.has(key)) continue
      seenPending.current.add(key)
      playSound('question')
    }
  }, [pending])

  // 出错（lastAgentError 变为新的非空值）
  React.useEffect(() => {
    const err = lastAgentError
    if (err !== null && err !== lastError.current) playSound('error')
    lastError.current = err
  }, [lastAgentError])

  return null
}
