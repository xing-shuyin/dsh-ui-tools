/**
 * The main tools panel — embedded in the layout's right `details` column
 * (not a popup), so it docks into the conversation page and can be collapsed
 * via the 收起 button (a floating reopen tab appears when collapsed). Three
 * tabs: files / terminal / git. All three views stay mounted (hidden with
 * CSS) so terminal scrollback and file-tree expansion survive tab switches.
 *
 * The panel follows the current session's workspace (cwd). A workspace
 * switcher in the Files view lets the user re-target the panel directly
 * (workspaces.connectWorkspace → sessions.open), mirroring pi-web-ui's
 * click-a-project-to-switch behavior.
 */
import * as React from 'react'
import { panelStore, type PanelTab } from './store'
import { setDetailsOpen } from './layout'
import { FilesView } from './FilesView'
import { TerminalView } from './TerminalView'
import { GitView } from './GitView'
import { JobsView } from './JobsView'
import { FiActivity, FiFile, FiGitBranch, FiTerminal } from './icons'

export interface WorkspaceInfo {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
}

interface PanelProps {
  useSessions?: (sel: (s: unknown) => unknown) => unknown
  useWorkspaces?: (sel: (s: unknown) => unknown) => unknown
  workspaces?: { connectWorkspace(id: string): Promise<string> }
  sessions?: { open(id: string): void }
}

const TABS: { tab: PanelTab; label: string; icon: React.ReactNode }[] = [
  { tab: 'files', label: '文件', icon: React.createElement(FiFile, { size: 13 }) },
  { tab: 'terminal', label: '终端', icon: React.createElement(FiTerminal, { size: 13 }) },
  { tab: 'git', label: 'Git', icon: React.createElement(FiGitBranch, { size: 13 }) },
  { tab: 'jobs', label: '任务', icon: React.createElement(FiActivity, { size: 13 }) },
]

export function Panel({ useSessions, useWorkspaces, workspaces, sessions }: PanelProps) {
  const state = usePanelState()
  const rootRef = React.useRef<HTMLDivElement>(null)
  // True while the details column is collapsed (width ~0): the slot stays
  // mounted at width 0, so we detect the closed state via ResizeObserver and
  // render a floating reopen button instead of the hidden panel.
  const [collapsed, setCollapsed] = React.useState(false)

  React.useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setCollapsed(el.getBoundingClientRect().width < 20)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // SnapshotSelectorHook requires a selector: useSessions((s) => ...).
  const current = useSessions ? useSessions((s: any) => s?.current) as string | undefined : undefined
  const byId = useSessions ? useSessions((s: any) => s?.byId ?? {}) as Record<string, { cwd?: string }> : undefined
  const cwd = current && byId ? byId[current]?.cwd ?? '' : ''
  const wsItems = useWorkspaces
    ? useWorkspaces((s: any) => s?.items ?? []) as WorkspaceInfo[]
    : undefined

  const onSwitchWorkspace = async (workspaceId: string) => {
    if (!workspaces?.connectWorkspace) return
    try {
      const sessionId = await workspaces.connectWorkspace(workspaceId)
      if (sessionId && sessions?.open) sessions.open(sessionId)
    } catch { /* workspace connect failed — ignore */ }
  }

  // The root div stays MOUNTED in both states so the ResizeObserver always
  // watches a live element: when the column widens again the observer fires
  // and the panel replaces the reopen tab (unmounting the observed node on
  // collapse would permanently freeze the collapsed state).
  return (
    <div ref={rootRef} className="ut-theme ut-panel">
      {collapsed ? (
        <button
          type="button"
          className="ut-reopen"
          title="展开工具面板"
          onClick={() => setDetailsOpen(true)}
        >
          🛠️
        </button>
      ) : (
        <>
          <div className="ut-panel-head">
        <div className="ut-view-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.tab}
              type="button"
              role="tab"
              aria-selected={state.tab === t.tab}
              className={state.tab === t.tab ? 'active' : ''}
              onClick={() => panelStore.set({ tab: t.tab })}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ut-panel-collapse"
          title="收起面板"
          onClick={() => setDetailsOpen(false)}
        >
          »
        </button>
      </div>
      <div className="ut-panel-body">
        <div className={`ut-view ${state.tab === 'files' ? '' : 'hidden'}`}>
          <FilesView cwd={cwd} workspaces={wsItems} onSwitchWorkspace={onSwitchWorkspace} />
        </div>
        <div className={`ut-view ${state.tab === 'terminal' ? '' : 'hidden'}`}>
          <TerminalView cwd={cwd} active={state.tab === 'terminal'} />
        </div>
        <div className={`ut-view ${state.tab === 'git' ? '' : 'hidden'}`}>
          <GitView cwd={cwd} />
        </div>
        <div className={`ut-view ${state.tab === 'jobs' ? '' : 'hidden'}`}>
          <JobsView sessionId={current} useSessions={useSessions as never} />
        </div>
      </div>
        </>
      )}
    </div>
  )
}

function usePanelState() {
  return React.useSyncExternalStore(panelStore.subscribe, panelStore.get)
}
