/**
 * Session-header actions — three small buttons that open the right tools
 * column on the matching tab (and collapse it when clicked again). Registered
 * in `conversation.session.header.actions`, so every session has them.
 */
import * as React from 'react'
import { panelStore, type PanelTab } from './store'
import { isDetailsOpen, setDetailsOpen } from './layout'
import { FiActivity, FiFile, FiGitBranch, FiTerminal } from './icons'

const TABS: { tab: PanelTab; label: string; icon: React.ReactNode; title: string }[] = [
  { tab: 'files', label: '文件', icon: React.createElement(FiFile, { size: 13 }), title: '项目文件' },
  { tab: 'terminal', label: '终端', icon: React.createElement(FiTerminal, { size: 13 }), title: '终端' },
  { tab: 'git', label: 'Git', icon: React.createElement(FiGitBranch, { size: 13 }), title: 'Git' },
  { tab: 'jobs', label: '任务', icon: React.createElement(FiActivity, { size: 13 }), title: '后台任务' },
]

export function HeaderActions() {
  const state = usePanelState()

  const toggle = (tab: PanelTab) => {
    if (state.tab === tab && isDetailsOpen()) {
      setDetailsOpen(false)
    } else {
      panelStore.set({ tab })
      setDetailsOpen(true)
    }
  }

  return (
    <div className="ut-theme ut-header-actions">
      {TABS.map((t) => (
        <button
          key={t.tab}
          type="button"
          className={`ut-header-btn ${state.tab === t.tab ? 'active' : ''}`}
          title={t.title}
          onClick={() => toggle(t.tab)}
        >
          <span>{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  )
}

function usePanelState() {
  return React.useSyncExternalStore(panelStore.subscribe, panelStore.get)
}
