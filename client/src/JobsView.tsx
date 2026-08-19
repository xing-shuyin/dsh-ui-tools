/**
 * 后台服务 (background servers) view — 监听并管理 AI 通过 bash/pwsh 在后台
 * 启动的服务（如 `npm run dev &`、`python -m http.server`）。Host 端在每次
 * shell 工具执行前后对比 LISTENING 端口，自动发现新服务并记录
 * { port, pid, since, name }；这里 5s 轮询刷新，可逐个停止（杀进程树）或
 * 全部停止；进程自己退出的条目由 Host 端 30s 周期清理，面板随之消失。
 *
 * 与模型 todo 无关：本面板只展示「真实运行的服务」。
 */
import * as React from 'react'
import { api } from './api'
import { FiRefreshCw, FiServer, FiX, FiXCircle } from './icons'

export interface BgServerView {
  port: number
  pid: number
  since: number
  name?: string
}

/** 启动时间 → "HH:MM"（与本地时区一致）。 */
function sinceLabel(since: number): string {
  try {
    const d = new Date(since)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

export function JobsView() {
  const [servers, setServers] = React.useState<BgServerView[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)

  const refresh = React.useCallback(() => {
    api<{ servers: BgServerView[] }>('/dsh-ui-tools/api/background-servers')
      .then((r) => setServers(r.servers))
      .catch((err) => setNotice((err as Error).message))
  }, [])

  React.useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const kill = async (port: number) => {
    setNotice(null)
    try {
      const r = await api<{ ok: boolean; error?: string }>('/dsh-ui-tools/api/background-servers/kill', {
        method: 'POST',
        body: { port },
      })
      setNotice(r.ok ? null : r.error ?? '停止失败')
      refresh()
    } catch (err) {
      setNotice((err as Error).message)
    }
  }

  const killAll = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const r = await api<{ ok: boolean; killed?: number[]; error?: string }>('/dsh-ui-tools/api/background-servers/kill-all', {
        method: 'POST',
        body: {},
      })
      if (!r.ok) setNotice(r.error ?? '关闭失败')
      refresh()
    } catch (err) {
      setNotice((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const running = servers?.length ?? 0

  return (
    <div className="ut-view" data-ut-view="jobs">
      <div className="panel-header">
        <span className="panel-title">后台服务</span>
        <div className="panel-header-actions">
          {running > 0 && (
            <button type="button" className="panel-refresh" title="全部停止" disabled={busy} onClick={() => void killAll()}>
              <FiXCircle size={13} /> 全部停止
            </button>
          )}
          <button type="button" className="panel-new" title="刷新" onClick={refresh}>
            <FiRefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="panel-body">
        {notice && <div className="panel-empty" style={{ fontSize: 11, color: 'var(--amber)' }}>{notice}</div>}
        {servers === null ? (
          <div className="panel-empty">加载中…</div>
        ) : servers.length === 0 ? (
          <div className="panel-empty">
            暂无后台服务
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-faint)' }}>
              AI 通过 bash/pwsh 在后台启动的服务（如 npm run dev &）会自动出现在这里，可单独或全部停止
            </div>
          </div>
        ) : (
          servers.map((s) => (
            <div key={s.port} className="job-item">
              <span className="job-icon">
                <FiServer size={14} />
              </span>
              <span className="job-main">
                <span className="job-label" title={s.name ?? `端口 ${s.port}`}>{s.name ?? `端口 ${s.port}`}</span>
                <span className="job-meta">
                  端口 {s.port} · pid {s.pid} · {sinceLabel(s.since)} 启动
                </span>
              </span>
              <span className="job-status running">运行中</span>
              <button
                type="button"
                className="job-close"
                title={`停止端口 ${s.port}（pid ${s.pid}）`}
                onClick={() => void kill(s.port)}
              >
                <FiX size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
