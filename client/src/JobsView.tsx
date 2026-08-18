/**
 * 后台任务 (background jobs) view — the current session's running/queued
 * background jobs (bash, subagents, …) with per-job close and close-all
 * buttons. Jobs are read from the session store's jobsBySession mirror; kills
 * go through the host jobs registry with the session's agent as the caller.
 */
import * as React from 'react'
import { api } from './api'
import { FiActivity, FiHardDrive, FiRefreshCw, FiX, FiXCircle } from './icons'

export interface JobView {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  detail?: string
  startedAt: number
  finishedAt?: number
}

interface JobsViewProps {
  sessionId?: string
  useSessions?: (sel: (s: any) => unknown) => unknown
}

const KIND_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  bash: FiHardDrive,
  pwsh: FiHardDrive,
}

function statusLabel(status: JobView['status']): string {
  switch (status) {
    case 'running': return '运行中'
    case 'stopping': return '停止中'
    case 'completed': return '已完成'
    case 'killed': return '已结束'
    case 'failed': return '失败'
  }
}

export function JobsView({ sessionId, useSessions }: JobsViewProps) {
  const jobsBySession = useSessions
    ? useSessions((s: any) => s?.jobsBySession ?? {}) as Record<string, readonly JobView[]>
    : undefined
  const jobs = sessionId && jobsBySession ? jobsBySession[sessionId] ?? [] : []
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)

  // Re-read whenever the session store changes; the store updates on
  // session/jobs frames, so the list stays fresh automatically.
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'stopping')

  const kill = async (jobId: string) => {
    if (!sessionId) return
    setNotice(null)
    try {
      const r = await api<{ ok: boolean; error?: string }>('/dsh-ui-tools/api/jobs/kill', {
        method: 'POST',
        body: { sessionId, jobId },
      })
      setNotice(r.ok ? null : r.error ?? '关闭失败')
    } catch (err) {
      setNotice((err as Error).message)
    }
  }

  const killAll = async () => {
    if (!sessionId) return
    setBusy(true)
    setNotice(null)
    try {
      const r = await api<{ ok: boolean; killed?: string[]; error?: string }>('/dsh-ui-tools/api/jobs/kill-all', {
        method: 'POST',
        body: { sessionId },
      })
      if (!r.ok) setNotice(r.error ?? '关闭失败')
    } catch (err) {
      setNotice((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ut-view" data-ut-view="jobs">
      <div className="panel-header">
        <span className="panel-title">后台任务</span>
        <div className="panel-header-actions">
          {running.length > 0 && (
            <button type="button" className="panel-refresh" title="全部关闭" onClick={() => void killAll()}>
              <FiXCircle size={13} /> 全部关闭
            </button>
          )}
          <button type="button" className="panel-new" title="刷新" onClick={() => setNotice('已刷新')}>
            <FiRefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="panel-body">
        {notice && <div className="panel-empty" style={{ fontSize: 11, color: 'var(--amber)' }}>{notice}</div>}
        {jobs.length === 0 ? (
          <div className="panel-empty">没有后台任务</div>
        ) : (
          jobs.map((job) => {
            const Icon = KIND_ICONS[job.kind] ?? FiActivity
            return (
              <div key={job.id} className="job-item">
                <span className="job-icon">
                  <Icon size={14} />
                </span>
                <span className="job-main">
                  <span className="job-label" title={job.label}>{job.label || job.id}</span>
                  <span className="job-meta">
                    {job.id} · {job.kind}
                    {job.detail ? ` · ${job.detail}` : ''}
                  </span>
                </span>
                <span className={`job-status ${job.status}`}>{statusLabel(job.status)}</span>
                {(job.status === 'running' || job.status === 'stopping') && (
                  <button
                    type="button"
                    className="job-close"
                    title={`关闭 ${job.id}`}
                    onClick={() => void kill(job.id)}
                  >
                    <FiX size={12} />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
