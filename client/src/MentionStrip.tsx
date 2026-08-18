/**
 * Mention strip — registered in `conversation.input.dock` (session scope).
 *
 * Shows the files the user picked in the file viewer / preview as chips
 * above the composer. The list lives in the module store; this component
 * syncs it to the host under its own session id, so when the user sends the
 * question the host attaches the file contents to that message (the
 * "mention" rides along with the question — no @-typing in the input box).
 */
import * as React from 'react'
import { mentionKey, mentionStore, type MentionFile } from './store'
import { api } from './api'

interface MentionStripProps {
  session?: { sessionId: string }
  useSessions?: () => { current?: string; byId: Record<string, { cwd?: string }> }
}

let syncTimer: ReturnType<typeof setTimeout> | null = null

export function MentionStrip({ session, useSessions }: MentionStripProps) {
  const files = useMentions()
  const stripRef = React.useRef<HTMLDivElement>(null)
  const sessionId = session?.sessionId ?? ''
  // SnapshotSelectorHook requires a selector: useSessions((s) => ...).
  const byId = useSessions ? useSessions((s) => s?.byId ?? {}) : undefined
  const cwd = sessionId && byId ? byId[sessionId]?.cwd ?? '' : ''

  // Sync to the host whenever the list or the session changes.
  React.useEffect(() => {
    if (!sessionId) return
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      void api('/dsh-ui-tools/api/mentions', {
        method: 'POST',
        body: { sessionId, cwd, files },
      }).catch(() => undefined)
    }, 120)
    return () => {
      if (syncTimer) clearTimeout(syncTimer)
    }
  }, [sessionId, cwd, files])

  // The host is the single source of truth for "were the mentions consumed":
  // after the user sends a question the host enriches the message and clears
  // its copy. Poll it; when it reports an empty list while the local strip is
  // non-empty, the send consumed the mentions — clear the local strip (the
  // write path is this client only, so a shorter server list can only mean a
  // consumption, never a foreign edit).
  React.useEffect(() => {
    if (!sessionId || files.length === 0) return
    const timer = setInterval(() => {
      void api<{ files: MentionFile[] }>(`/dsh-ui-tools/api/mentions?sessionId=${encodeURIComponent(sessionId)}`)
        .then((r) => {
          if (r.files.length === 0 && mentionStore.get().length > 0) mentionStore.clear()
        })
        .catch(() => undefined)
    }, 1500)
    return () => clearInterval(timer)
  }, [sessionId, files.length])

  // Align the strip with the composer's textarea left edge — robust across
  // every width change (panel drag resizes the layout frame and the
  // textarea, but not the window/body, so window-resize alone misses it):
  // observe the textarea, the layout frame and our own panel, plus a cheap
  // interval as the safety net.
  React.useEffect(() => {
    if (files.length === 0) return
    const align = () => {
      const strip = stripRef.current
      const ta = document.querySelector('textarea')
      if (!strip || !ta) return
      const gap = Math.max(0, Math.round(ta.getBoundingClientRect().x - strip.getBoundingClientRect().x))
      strip.style.paddingLeft = `${gap}px`
      strip.style.paddingRight = `${gap}px`
    }
    align()
    window.addEventListener('resize', align)
    const ros: ResizeObserver[] = []
    if (typeof ResizeObserver !== 'undefined') {
      const targets = [
        document.querySelector('textarea'),
        document.querySelector('[data-ut-layout]'),
        document.querySelector('.ut-panel'),
      ]
      for (const t of targets) {
        if (!t) continue
        const ro = new ResizeObserver(align)
        ro.observe(t)
        ros.push(ro)
      }
    }
    const timer = setInterval(align, 300)
    return () => {
      window.removeEventListener('resize', align)
      for (const ro of ros) ro.disconnect()
      clearInterval(timer)
    }
  }, [files.length])

  if (files.length === 0) return null

  return (
    <div ref={stripRef} className="ut-theme ut-mentions">
      {files.map((f) => (
        <div key={mentionKey(f)} className="ut-mention-row" title={mentionTitle(f)}>
          <span className="ut-mention-tag">{f.isDir ? '[引用]' : '[文件]'}</span>
          <span className="ut-mention-path">{f.path}</span>
          {f.mode === 'lines' && f.lines && (
            <span className="ut-mention-lines">（第 {f.lines.start}–{f.lines.end} 行）</span>
          )}
          <button
            type="button"
            className="ut-mention-x"
            title="移除"
            onClick={() => mentionStore.remove(mentionKey(f))}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="ut-mention-clear" onClick={() => mentionStore.clear()}>清空</button>
    </div>
  )
}

function mentionTitle(f: MentionFile): string {
  if (f.mode === 'lines' && f.lines) return `${f.path}（第 ${f.lines.start}–${f.lines.end} 行）`
  if (f.isDir) return `文件夹：${f.path}（引用）`
  return f.path
}

function useMentions(): MentionFile[] {
  return React.useSyncExternalStore(mentionStore.subscribe, mentionStore.get)
}
