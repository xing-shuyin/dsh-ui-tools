/**
 * 设置 view — 行内标记任务列表（marker）功能的开关。
 *
 * 该功能是 harness 进程级的模型行为（todo_write 停用 / [[todo:...]] 标记解析），
 * 所以开关是全局的（与工作区无关），持久化在宿主端 `~/.dsh-ui-tools/settings.json`，
 * 切换立即生效：停用时恢复原生 `todo_write` 工具，启用时重新挂载 marker 集成。
 */
import * as React from 'react'
import { api } from './api'
import { SoundSettingsSection } from './SoundSettings'

export function SettingsView() {
  const [markerEnabled, setMarkerEnabled] = React.useState<boolean | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    api<{ markerEnabled: boolean }>('/dsh-ui-tools/api/settings')
      .then((r) => { if (alive) setMarkerEnabled(r.markerEnabled) })
      .catch((err) => { if (alive) setNotice((err as Error).message) })
    return () => { alive = false }
  }, [])

  const toggle = async () => {
    if (markerEnabled === null || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const r = await api<{ ok: boolean; markerEnabled: boolean; error?: string }>(
        '/dsh-ui-tools/api/settings',
        { method: 'POST', body: { markerEnabled: !markerEnabled } },
      )
      setMarkerEnabled(r.markerEnabled)
      setNotice(r.ok ? null : r.error ?? '设置失败')
    } catch (err) {
      setNotice((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const on = markerEnabled === true
  const loading = markerEnabled === null

  return (
    <div className="ut-view" data-ut-view="settings">
      <div className="panel-header">
        <span className="panel-title">设置</span>
      </div>
      <div className="panel-body">
        <div className="settings-row">
          <div className="settings-info">
            <div className="settings-label">行内标记任务列表（marker）</div>
            <div className="settings-desc">
              启用时：`todo_write` 工具停用，回复正文中的 [[todo:...]] 行内标记会被自动解析并写入任务面板；
              停用时：恢复原生 `todo_write` 工具，不再解析标记。切换立即生效（对所有工作区）。
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            className={`ut-switch${on ? ' on' : ''}`}
            disabled={loading || busy}
            onClick={() => void toggle()}
            title={loading ? '加载中…' : on ? '点击停用 marker 功能' : '点击启用 marker 功能'}
          >
            <span className="ut-switch-knob" />
          </button>
        </div>
        <SoundSettingsSection />
        {notice && (
          <div className="panel-empty" style={{ fontSize: 11, color: 'var(--amber)' }}>{notice}</div>
        )}
      </div>
    </div>
  )
}
