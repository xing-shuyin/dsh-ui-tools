/**
 * 设置 view — 内联标记（marker）功能的开关。
 *
 * 两级控制：
 *   - 全局总开关：停用整个内联标记框架（inlineMarkers 服务、markers_list、
 *     [[tool:op:...]] 解析分发全部卸载），恢复原生 todo_write。
 *   - 插件级开关：每个注册的 marker 插件（todo、第三方 bundle 注册的）可单独
 *     停用。todo 停用时其标记不再执行、恢复原生 todo_write，其他插件不受影响。
 *
 * 该功能是 harness 进程级的模型行为，所以开关是全局的（与工作区无关），持久化
 * 在宿主端 `~/.dsh-ui-tools/settings.json`，切换立即生效。
 */
import * as React from 'react'
import { api } from './api'
import { SoundSettingsSection } from './SoundSettings'

interface ToolEntry {
  name: string
  description: string
  enabled: boolean
}

interface SettingsState {
  enabled: boolean
  tools: ToolEntry[]
}

function Switch({ on, disabled, onToggle, title }: {
  on: boolean
  disabled?: boolean
  onToggle: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`ut-switch${on ? ' on' : ''}`}
      disabled={disabled}
      onClick={onToggle}
      title={title}
    >
      <span className="ut-switch-knob" />
    </button>
  )
}

export function SettingsView() {
  const [state, setState] = React.useState<SettingsState | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    api<{ markerEnabled: boolean; markers: SettingsState }>('/dsh-ui-tools/api/settings')
      .then((r) => { if (alive) setState(r.markers) })
      .catch((err) => { if (alive) setNotice((err as Error).message) })
    return () => { alive = false }
  }, [])

  const post = async (body: unknown) => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const r = await api<{ ok: boolean; error?: string; enabled?: boolean; tools?: ToolEntry[] }>(
        '/dsh-ui-tools/api/settings',
        { method: 'POST', body },
      )
      if (r.ok && r.tools) setState({ enabled: !!r.enabled, tools: r.tools })
      setNotice(r.ok ? null : r.error ?? '设置失败')
    } catch (err) {
      setNotice((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggleGlobal = () => {
    if (!state) return
    void post({ markers: { enabled: !state.enabled } })
  }

  const toggleTool = (name: string, enabled: boolean) => {
    void post({ markers: { tools: { [name]: !enabled } } })
  }

  const loading = state === null

  return (
    <div className="ut-view" data-ut-view="settings">
      <div className="panel-header">
        <span className="panel-title">设置</span>
      </div>
      <div className="panel-body">
        <div className="settings-row">
          <div className="settings-info">
            <div className="settings-label">
              内联标记（marker）· 全局开关
              <span className="ut-tip-wrap" tabIndex={0} title="">
                <span className="ut-tip-icon" aria-hidden="true">?</span>
                <span className="ut-tip-pop" role="tooltip">
                  {'启用时：解析回复正文中的 [[tool:op:...]] 行内标记（如 [[todo:...]]），\n\n停用时：整个内联标记框架卸载，恢复原生工具（如 todo_write），不再解析标记。\n\n切换立即生效（对所有工作区）。'}
                </span>
              </span>
            </div>
          </div>
          <Switch
            on={state?.enabled === true}
            disabled={loading || busy}
            onToggle={toggleGlobal}
            title={loading ? '加载中…' : state?.enabled ? '点击停用全部内联标记插件' : '点击启用内联标记框架'}
          />
        </div>

        {state?.tools.map((t) => (
          <div className="settings-row" key={t.name}>
            <div className="settings-info">
              <div className="settings-label">{t.name}</div>
              {t.description && <div className="settings-desc">{t.description}</div>}
            </div>
            <Switch
              on={t.enabled}
              disabled={busy}
              onToggle={() => toggleTool(t.name, t.enabled)}
              title={`${t.enabled ? '停用' : '启用'} ${t.name} 插件`}
            />
          </div>
        ))}

        <SoundSettingsSection />
        {notice && (
          <div className="panel-empty" style={{ fontSize: 11, color: 'var(--amber)' }}>{notice}</div>
        )}
      </div>
    </div>
  )
}
