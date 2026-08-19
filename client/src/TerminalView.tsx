/**
 * Terminal view — ported from pi-web-ui (TerminalPanel + TermXterm).
 *
 * Left column: the workspace quick-command list (persisted in
 * `.dsh-ui-tools/commands.json`, editable name / command / cwd) on top, and
 * the terminal tabs below. Right: one xterm per tab (kept mounted while
 * hidden so scrollback survives tab switches).
 *
 * Each xterm creates its PTY via the host (node-pty) and streams output over
 * an SSE connection; input/resize/heartbeat are POSTs.
 */
import * as React from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api, encodeCwd, type CommandDef } from './api'
import { FiEdit2, FiPlay, FiPlus, FiRefreshCw, FiTerminal, FiTrash2, FiX } from './icons'
import { termStore, type TermCommand, type TermTab } from './store'
import { themeStore } from './theme'

interface TerminalViewProps {
  cwd: string
  /** True when this view is the visible panel tab (drives auto-create). */
  active: boolean
  /** True when the panel is too narrow for the two-pane layout (side column
   *  becomes a drawer). */
  narrow?: boolean
}

// ---------------------------------------------------------------------------
// xterm 配色：跟随 dsh 主题切换。背景/前景/光标读 shell 的 --dsw-alias-* token
// （任何主题，包括第三方注册主题都能对齐），ANSI 16 色用亮/暗两套固定调色板。
// ---------------------------------------------------------------------------

/** 读取 body 上定义的 CSS 变量（computed value 已解析 var() 链）。 */
function readBodyVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim()
    return v || fallback
  } catch {
    return fallback
  }
}

const DARK_ANSI: Record<string, string> = {
  black: '#1a1d26', red: '#f87171', green: '#34d399', yellow: '#fbbf24',
  blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e6e8ef',
  brightBlack: '#6b7284', brightRed: '#f87171', brightGreen: '#34d399',
  brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#c084fc',
  brightCyan: '#22d3ee', brightWhite: '#ffffff',
}
const LIGHT_ANSI: Record<string, string> = {
  black: '#3f3f46', red: '#dc2626', green: '#16a34a', yellow: '#d97706',
  blue: '#2563eb', magenta: '#9333ea', cyan: '#0891b2', white: '#f4f4f5',
  brightBlack: '#71717a', brightRed: '#ef4444', brightGreen: '#22c55e',
  brightYellow: '#f59e0b', brightBlue: '#3b82f6', brightMagenta: '#a855f7',
  brightCyan: '#06b6d4', brightWhite: '#ffffff',
}

function buildXtermTheme(): Record<string, string> {
  const dark = themeStore.get()
  const bg = readBodyVar('--dsw-alias-bg-base', dark ? '#0b0d12' : '#ffffff')
  const fg = readBodyVar('--dsw-alias-label-primary', dark ? '#e6e8ef' : '#1f2937')
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: dark ? 'rgba(139, 92, 246, 0.35)' : 'rgba(59, 130, 246, 0.25)',
    ...(dark ? DARK_ANSI : LIGHT_ANSI),
  }
}

// ---------------------------------------------------------------------------
// one xterm instance
// ---------------------------------------------------------------------------

interface TermXtermProps {
  tab: TermTab
  active: boolean
}

function TermXterm({ tab, active }: TermXtermProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const instRef = React.useRef<{ term: Terminal; fit: FitAddon } | null>(null)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 8000,
      theme: buildXtermTheme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    instRef.current = { term, fit }
    if (active) term.focus()

    // 主题切换 → 重绘 xterm 配色。
    const offTheme = themeStore.subscribe(() => {
      const inst = instRef.current
      if (inst) inst.term.options.theme = buildXtermTheme()
    })

    // Ctrl+V / Cmd+V → browser-native paste; Ctrl+C with a selection → copy.
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true
      const key = event.key?.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'v') return false
      if (event.ctrlKey && !event.shiftKey && !event.altKey && key === 'c') {
        if (term.hasSelection()) {
          const ta = term.textarea
          if (ta) {
            ta.value = term.getSelection()
            ta.select()
          }
          return false
        }
      }
      return true
    })

    let es: EventSource | null = null
    let disposed = false

    const sendDims = () => {
      try {
        fit.fit()
        void api(`/dsh-ui-tools/api/terminal/${encodeURIComponent(tab.id)}/resize`, {
          method: 'POST',
          body: { cols: term.cols, rows: term.rows },
        })
      } catch { /* container hidden */ }
    }

    const openStream = () => {
      if (disposed) return
      es = new EventSource(`/dsh-ui-tools/api/terminal/${encodeURIComponent(tab.id)}/stream`)
      es.onmessage = (ev) => {
        if (disposed) return
        try {
          const msg = JSON.parse(ev.data) as { type: string; data?: string; buffer?: string; exited?: boolean; exitCode?: number | null }
          if (msg.type === 'init') {
            if (msg.buffer) term.write(msg.buffer)
            if (msg.exited) {
              termStore.updateTab(tab.id, { running: false, exitCode: msg.exitCode ?? null })
            }
          } else if (msg.type === 'output' && typeof msg.data === 'string') {
            term.write(msg.data)
          } else if (msg.type === 'exit') {
            termStore.updateTab(tab.id, { running: false, exitCode: msg.exitCode ?? null })
          }
        } catch { /* ignore malformed */ }
      }
      es.onerror = () => {
        // EventSource auto-reconnects; the host re-sends the buffered tail.
      }
    }

    const raf = requestAnimationFrame(() => {
      try { fit.fit() } catch { /* ignore */ }
      void (async () => {
        try {
          await api('/dsh-ui-tools/api/terminal', {
            method: 'POST',
            body: {
              id: tab.id,
              cwd: tab.cwd,
              cols: term.cols,
              rows: term.rows,
              command: tab.command ?? undefined,
              title: tab.title,
            },
          })
          openStream()
        } catch (err) {
          if (!disposed) {
            term.write(`\r\n\x1b[91m[启动终端失败] ${(err as Error).message}\x1b[0m\r\n`)
            termStore.updateTab(tab.id, { running: false, exitCode: null })
          }
        }
      })()
    })

    const onData = term.onData((data) => {
      void api(`/dsh-ui-tools/api/terminal/${encodeURIComponent(tab.id)}/input`, {
        method: 'POST',
        body: { data },
      })
    })

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (container.offsetWidth > 0 && container.offsetHeight > 0) sendDims()
      })
      ro.observe(container)
    }

    const hb = setInterval(() => {
      void api(`/dsh-ui-tools/api/terminal/${encodeURIComponent(tab.id)}/heartbeat`, { method: 'POST' })
    }, 15_000)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      clearInterval(hb)
      offTheme()
      onData.dispose()
      ro?.disconnect()
      es?.close()
      instRef.current = null
      term.dispose()
      // best-effort kill on unmount (keepalive so the tab close reaches the host)
      try {
        void fetch('/dsh-ui-tools/api/terminal', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: tab.id }),
          keepalive: true,
        })
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  // Becoming visible: re-fit and focus.
  React.useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => {
      const inst = instRef.current
      if (!inst) return
      try {
        inst.fit.fit()
        void api(`/dsh-ui-tools/api/terminal/${encodeURIComponent(tab.id)}/resize`, {
          method: 'POST',
          body: { cols: inst.term.cols, rows: inst.term.rows },
        })
      } catch { /* ignore */ }
      inst.term.focus()
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return (
    <div ref={containerRef} className={`term-xterm ${active ? '' : 'hidden'}`} />
  )
}

// ---------------------------------------------------------------------------
// command list editing (port of the pi-web-ui command editor)
// ---------------------------------------------------------------------------

interface Draft {
  name: string
  command: string
  cwd: string
}

const EMPTY_DRAFT: Draft = { name: '', command: '', cwd: '${pwd}' }

// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------

export function TerminalView({ cwd, active, narrow = false }: TerminalViewProps) {
  const tabs = useTermTabs()
  const activeId = useTermActiveId()
  const setActiveId = React.useCallback((id: string | null) => termStore.setActiveId(id), [])
  const [commands, setCommands] = React.useState<CommandDef[]>([])
  const [isNew, setIsNew] = React.useState(false)
  const [editingIdx, setEditingIdx] = React.useState<number | null>(null)
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT)
  const [confirmDel, setConfirmDel] = React.useState<number | null>(null)
  const [cmdWarning, setCmdWarning] = React.useState<string | null>(null)

  const refreshCommands = React.useCallback(async () => {
    if (!cwd) return
    try {
      const r = await api<{ commands: CommandDef[]; warning?: string }>(
        `/dsh-ui-tools/api/commands?cwd=${encodeCwd(cwd)}`,
      )
      setCommands(r.commands)
      setCmdWarning(r.warning ?? null)
    } catch { /* ignore */ }
  }, [cwd])

  React.useEffect(() => {
    void refreshCommands()
  }, [refreshCommands])

  // Keep the active tab valid (activeId is now owned by termStore; addTab
  // activates the new tab automatically, removeTab repairs the selection).
  React.useEffect(() => {
    if (tabs.length === 0) setActiveId(null)
    else if (!tabs.some((t) => t.id === activeId)) {
      setActiveId(tabs[tabs.length - 1].id)
    }
  }, [tabs, activeId, setActiveId])

  // Switching to the terminal tab with no terminal open → open one
  // automatically (same behavior as pi-web-ui's first terminal-view click).
  React.useEffect(() => {
    if (active && tabs.length === 0 && cwd) {
      const tab: TermTab = {
        id: `term-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        title: termStore.nextTitle(),
        cwd,
        command: null,
        running: true,
        exitCode: null,
      }
      termStore.addTab(tab)
      setActiveId(tab.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tabs.length, cwd])

  const openShell = () => {
    const tab: TermTab = {
      id: `term-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      title: termStore.nextTitle(),
      cwd,
      command: null,
      running: true,
      exitCode: null,
    }
    termStore.addTab(tab)
    setActiveId(tab.id)
  }

  const runCommand = (cmd: CommandDef) => {
    const title = cmd.name || cmd.command
    // Re-run: replace the existing tab with the same title.
    const existing = tabs.find((t) => t.title === title)
    if (existing) {
      termStore.removeTab(existing.id)
      setActiveId(null)
    }
    const tab: TermTab = {
      id: `term-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      title,
      cwd,
      command: { name: cmd.name, command: cmd.command, cwd: cmd.cwd },
      running: true,
      exitCode: null,
    }
    termStore.addTab(tab)
    setActiveId(tab.id)
  }

  const closeTab = (id: string) => {
    termStore.removeTab(id)
    if (activeId === id) {
      const rest = tabs.filter((t) => t.id !== id)
      setActiveId(rest.length > 0 ? rest[rest.length - 1].id : null)
    }
  }

  const startNew = () => {
    setIsNew(true)
    setEditingIdx(null)
    setDraft(EMPTY_DRAFT)
  }

  const startEdit = (idx: number) => {
    const c = commands[idx]
    if (!c) return
    setIsNew(false)
    setEditingIdx(idx)
    setDraft({ name: c.name, command: c.command, cwd: c.cwd ?? '' })
  }

  const cancelEdit = () => {
    setIsNew(false)
    setEditingIdx(null)
  }

  const saveDraft = async () => {
    const name = draft.name.trim()
    const command = draft.command.trim()
    if (!name || !command) return
    const cwdVal = draft.cwd.trim()
    const def: CommandDef = { name, command, cwd: cwdVal ? cwdVal : undefined }
    const next = isNew
      ? [...commands, def]
      : editingIdx !== null
        ? commands.map((c, i) => (i === editingIdx ? def : c))
        : commands
    try {
      await api('/dsh-ui-tools/api/commands', { method: 'POST', body: { cwd, commands: next } })
      setCommands(next)
      cancelEdit()
    } catch (err) {
      setCmdWarning(`保存失败：${(err as Error).message}`)
    }
  }

  const requestDelete = async (idx: number) => {
    if (confirmDel === idx) {
      const next = commands.filter((_, i) => i !== idx)
      try {
        await api('/dsh-ui-tools/api/commands', { method: 'POST', body: { cwd, commands: next } })
        setCommands(next)
        setConfirmDel(null)
      } catch (err) {
        setCmdWarning(`保存失败：${(err as Error).message}`)
      }
    } else {
      setConfirmDel(idx)
      setTimeout(() => setConfirmDel((v) => (v === idx ? null : v)), 2500)
    }
  }

  const editing = isNew || editingIdx !== null

  return (
    <div className="ut-view" data-ut-view="terminal">
      <div className="terminal-view">
        {editing ? (
          /* Command edit form — replaces the strips while editing. */
          <div className="cmd-form-block">
            <div className="cmd-form">
              <label>名称</label>
              <input
                className="cmd-input"
                value={draft.name}
                placeholder="例如：启动开发服务"
                autoFocus
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <label>命令</label>
              <input
                className="cmd-input"
                value={draft.command}
                placeholder="例如：npm run dev"
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveDraft()
                }}
              />
              <label>运行目录（${'{pwd}'} = 会话工作区）</label>
              <input
                className="cmd-input"
                value={draft.cwd}
                placeholder="${pwd}"
                onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveDraft()
                }}
              />
              <div className="cmd-form-actions">
                <button type="button" className="btn" onClick={cancelEdit}>取消</button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={!draft.name.trim() || !draft.command.trim()}
                  onClick={() => void saveDraft()}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* One row: quick-command strip + terminal-tab strip (horizontal). */
          <div className="term-strips">
            <div className="term-strip">
              <div className="term-strip-head">
                <span className="panel-title">快捷命令</span>
                <div className="term-strip-head-actions">
                  <button type="button" className="panel-refresh" title="刷新" onClick={() => void refreshCommands()}>
                    <FiRefreshCw size={13} />
                  </button>
                  <button type="button" className="panel-new" title="新建命令" onClick={startNew}>
                    <FiPlus size={14} />
                  </button>
                </div>
              </div>
              <div className="term-strip-row">
                {cmdWarning && <span className="cmd-strip-warn" title={cmdWarning}>⚠</span>}
                {commands.length === 0 && !cmdWarning && (
                  <span className="cmd-strip-empty">还没有快捷命令</span>
                )}
                {commands.map((c, i) => (
                  <div key={i} className={`cmd-chip${confirmDel === i ? ' confirm' : ''}`}>
                    <button
                      type="button"
                      className="cmd-run"
                      title={`运行：${c.command}${c.cwd ? `\n目录：${c.cwd}` : ''}`}
                      onClick={() => runCommand(c)}
                    >
                      <FiPlay size={12} />
                    </button>
                    <button
                      type="button"
                      className="cmd-chip-main"
                      title={`${c.command}${c.cwd ? `\n目录：${c.cwd}` : ''}`}
                      onClick={() => runCommand(c)}
                    >
                      <span className="cmd-name">{c.name}</span>
                      <span className="cmd-command">{c.command}</span>
                    </button>
                    <button type="button" className="cmd-act" title="编辑" onClick={() => startEdit(i)}>
                      <FiEdit2 size={12} />
                    </button>
                    <button
                      type="button"
                      className={`cmd-act del${confirmDel === i ? ' confirm' : ''}`}
                      title="删除"
                      onClick={() => void requestDelete(i)}
                    >
                      {confirmDel === i ? '确认?' : <FiTrash2 size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="term-strip">
              <div className="term-strip-head">
                <span className="panel-title">终端</span>
                <div className="term-strip-head-actions">
                  <button type="button" className="panel-new" title="新建终端" onClick={openShell}>
                    <FiPlus size={14} />
                  </button>
                </div>
              </div>
              <div className="term-strip-row">
                {tabs.length === 0 && <span className="cmd-strip-empty">没有打开的终端</span>}
                {tabs.map((tab) => (
                  <div key={tab.id} className={`term-tab-chip ${tab.id === activeId ? 'active' : ''}`}>
                    <button
                      type="button"
                      className="term-tab-main"
                      title={`${tab.cwd}${tab.command ? `\n> ${tab.command.command}` : ''}`}
                      onClick={() => setActiveId(tab.id)}
                    >
                      <span className={`term-tab-dot ${tab.running ? 'run' : 'exit'}`} />
                      <span className="term-tab-title">
                        {tab.title}
                        {!tab.running && <span className="term-tab-exit">（已退出 {tab.exitCode ?? ''}）</span>}
                      </span>
                    </button>
                    <button type="button" className="term-tab-close" title="关闭终端" onClick={() => closeTab(tab.id)}>
                      <FiX size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="term-main">
          {tabs.length === 0 ? (
            <div className="term-empty">
              <FiTerminal className="term-empty-icon" size={34} />
              <div className="term-empty-title">内置终端</div>
              <div className="term-empty-sub">点击快捷命令直接运行，或点「＋」新建终端</div>
            </div>
          ) : (
            tabs.map((tab) => (
              <TermXterm key={tab.id} tab={tab} active={tab.id === activeId} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function useTermTabs(): TermTab[] {
  return React.useSyncExternalStore(termStore.subscribe, termStore.getTabs)
}

function useTermActiveId(): string | null {
  return React.useSyncExternalStore(termStore.subscribe, termStore.getActiveId)
}
