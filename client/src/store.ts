/**
 * Module-level shared state for dsh-ui-tools client.
 *
 * The plugin registers UI in several slots (details column, session header,
 * input dock). Slots mount/unmount independently and per session, so the
 * panel's active tab, the terminal tabs, and the mention list live here as
 * plain observable stores instead of React state. The details column's
 * open/closed state is owned by the layout service; this store only tracks
 * which tab the panel shows.
 */

export type PanelTab = 'files' | 'terminal' | 'git' | 'jobs' | 'settings'

export interface PanelState {
  tab: PanelTab
}

// ---------------------------------------------------------------------------
// panel store
// ---------------------------------------------------------------------------

const panelListeners = new Set<() => void>()
let panelState: PanelState = { tab: 'files' }

export const panelStore = {
  get(): PanelState {
    return panelState
  },
  set(patch: Partial<PanelState>): void {
    panelState = { ...panelState, ...patch }
    for (const fn of panelListeners) fn()
  },
  subscribe(fn: () => void): () => void {
    panelListeners.add(fn)
    return () => { panelListeners.delete(fn) }
  },
}

// ---------------------------------------------------------------------------
// terminal tabs store
// ---------------------------------------------------------------------------

export interface TermCommand {
  name: string
  command: string
  cwd?: string
}

export interface TermTab {
  id: string
  title: string
  cwd: string
  command?: TermCommand | null
  running: boolean
  exitCode: number | null
}

const termListeners = new Set<() => void>()
let termTabs: TermTab[] = []
let termSeq = 0
/** 当前激活的终端 tab id（全局，addTab 自动激活——让 Git tab 等外部 addTab 的新终端立即可见）。 */
let termActiveId: string | null = null

export const termStore = {
  getTabs(): TermTab[] {
    return termTabs
  },
  getActiveId(): string | null {
    return termActiveId
  },
  addTab(tab: TermTab): void {
    termTabs = [...termTabs, tab]
    termActiveId = tab.id // 新 tab 自动激活
    emitTerms()
  },
  updateTab(id: string, patch: Partial<TermTab>): void {
    termTabs = termTabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
    emitTerms()
  },
  removeTab(id: string): void {
    termTabs = termTabs.filter((t) => t.id !== id)
    if (termActiveId === id) {
      termActiveId = termTabs.length > 0 ? termTabs[termTabs.length - 1].id : null
    }
    emitTerms()
  },
  setActiveId(id: string | null): void {
    if (termActiveId !== id) {
      termActiveId = id
      emitTerms()
    }
  },
  nextTitle(): string {
    termSeq += 1
    return `终端 ${termSeq}`
  },
  subscribe(fn: () => void): () => void {
    termListeners.add(fn)
    return () => { termListeners.delete(fn) }
  },
}

function emitTerms(): void {
  for (const fn of termListeners) fn()
}

// ---------------------------------------------------------------------------
// mention store (a single pending list; the session-scoped dock strip syncs
// it to the host under the session it is mounted in, so mentions ride along
// with that session's next question)
// ---------------------------------------------------------------------------

export type MentionMode = 'inline' | 'reference' | 'lines'

export interface MentionFile {
  path: string
  name: string
  mode: MentionMode
  isDir?: boolean
  /** 1-based inclusive line range (mode "lines" only). */
  lines?: { start: number; end: number }
}

const mentionListeners = new Set<() => void>()
let mentionFiles: MentionFile[] = []

export const mentionStore = {
  get(): MentionFile[] {
    return mentionFiles
  },
  add(file: MentionFile): void {
    const key = `${file.path}|${file.mode}|${file.lines ? `${file.lines.start}-${file.lines.end}` : ''}`
    const exists = mentionFiles.some(
      (a) => `${a.path}|${a.mode}|${a.lines ? `${a.lines.start}-${a.lines.end}` : ''}` === key,
    )
    if (exists) return
    mentionFiles = [...mentionFiles, file]
    emitMentions()
  },
  remove(key: string): void {
    mentionFiles = mentionFiles.filter(
      (a) => `${a.path}|${a.mode}|${a.lines ? `${a.lines.start}-${a.lines.end}` : ''}` !== key,
    )
    emitMentions()
  },
  clear(): void {
    if (mentionFiles.length === 0) return
    mentionFiles = []
    emitMentions()
  },
  subscribe(fn: () => void): () => void {
    mentionListeners.add(fn)
    return () => { mentionListeners.delete(fn) }
  },
}

export function mentionKey(f: MentionFile): string {
  return `${f.path}|${f.mode}|${f.lines ? `${f.lines.start}-${f.lines.end}` : ''}`
}

function emitMentions(): void {
  for (const fn of mentionListeners) fn()
}
