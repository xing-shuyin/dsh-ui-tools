/**
 * Project file viewer — pi-web-ui's RightPanel layout: breadcrumb navigation
 * plus a flat file list (folders first), with Feather icons. Follows the
 * current session's workspace (cwd); a workspace switcher sits in the crumbs
 * row. Clicking a file opens the preview modal; the ＋/link buttons mention
 * the file/folder (rides along with the next question).
 */
import * as React from 'react'
import { api, encodeCwd, type FileEntry, type FileListing } from './api'
import { mentionStore, type MentionFile } from './store'
import { FilePreview } from './FilePreview'
import type { WorkspaceInfo } from './Panel'
import {
  FiChevronRight, FiDownload, FiFile, FiFolder, FiLink, FiPlus, FiRefreshCw,
} from './icons'

interface FilesViewProps {
  cwd: string
  /** Workspace rows for the switcher dropdown (undefined = hide the switcher). */
  workspaces?: WorkspaceInfo[]
  /** Switch the whole session to a workspace (connect + open). */
  onSwitchWorkspace?: (workspaceId: string) => void
}

export function FilesView({ cwd, workspaces, onSwitchWorkspace }: FilesViewProps) {
  const [currentPath, setCurrentPath] = React.useState('')
  const [listing, setListing] = React.useState<FileListing | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<{ path: string; name: string } | null>(null)
  const [savedTick, setSavedTick] = React.useState(0)

  // The workspace whose path equals the current cwd (or '' when none matches).
  const currentWs = workspaces?.find((w) => w.path === cwd)?.workspaceId ?? ''

  const load = React.useCallback(async (path: string, silent = false) => {
    setCurrentPath(path)
    if (!silent) setLoading(true)
    setError(null)
    try {
      const l = await api<FileListing>(`/dsh-ui-tools/api/files?cwd=${encodeCwd(cwd)}&path=${encodeURIComponent(path)}`)
      setListing(l)
    } catch (err) {
      setError((err as Error).message)
      setListing(null)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [cwd])

  // Re-root on workspace change and on demand.
  React.useEffect(() => {
    setCurrentPath('')
    void load('', true)
  }, [cwd, load, savedTick])

  // Silent refresh of the current directory every 10s.
  React.useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void load(currentPath, true)
    }, 10_000)
    return () => clearInterval(timer)
  }, [currentPath, load])

  const goUp = () => {
    if (listing?.parent !== null && listing?.parent !== undefined) {
      void load(listing.parent)
    }
  }

  const crumbs = currentPath.split('/').filter(Boolean)

  const mention = (file: MentionFile) => {
    mentionStore.add(file)
  }

  const download = (e: React.MouseEvent, path: string, name: string) => {
    e.preventDefault()
    e.stopPropagation()
    const a = document.createElement('a')
    a.href = `/dsh-ui-tools/api/raw?cwd=${encodeCwd(cwd)}&path=${encodeURIComponent(path)}`
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="ut-view" data-ut-view="files">
      <div className="panel-crumbs">
        {workspaces && workspaces.length > 0 && onSwitchWorkspace ? (
          <select
            className="scm-select"
            title="切换工作区（面板、终端、Git 将随之切换）"
            value={currentWs}
            onChange={(e) => {
              if (e.target.value) onSwitchWorkspace(e.target.value)
            }}
          >
            <option value="" disabled>
              {cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || '工作区' : '选择工作区…'}
            </option>
            {workspaces.map((w) => (
              <option key={w.workspaceId} value={w.workspaceId} title={w.path}>
                {w.title || w.path.split(/[\\/]/).filter(Boolean).pop() || w.path}
              </option>
            ))}
          </select>
        ) : (
          <span className="crumb active" title={cwd}>{cwd || '（未选择工作区）'}</span>
        )}
        <button type="button" className="panel-refresh" title="刷新" onClick={() => setSavedTick((t) => t + 1)}>
          <FiRefreshCw size={13} />
        </button>
      </div>

      <div className="panel-crumbs">
        <button type="button" className={`crumb ${currentPath === '' ? 'active' : ''}`} onClick={() => void load('')}>
          <FiFolder size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          根目录
        </button>
        {crumbs.map((c, i) => {
          const path = crumbs.slice(0, i + 1).join('/')
          return (
            <span key={path} className="crumb-seg">
              <FiChevronRight size={12} style={{ verticalAlign: -2 }} />
              <button type="button" className={`crumb ${path === currentPath ? 'active' : ''}`} onClick={() => void load(path)}>
                {c}
              </button>
            </span>
          )
        })}
      </div>

      <div className="panel-body">
        {loading && <div className="panel-empty">加载中…</div>}
        {error && <div className="panel-empty" style={{ color: 'var(--red)' }}>{error}</div>}
        {!loading && !error && !cwd && (
          <div className="panel-empty">打开或新建一个会话后，这里会显示项目文件</div>
        )}
        {!loading && !error && cwd && listing && (
          <>
            {listing.path !== '' && (
              <button type="button" className="file-item dir" onClick={goUp}>
                <FiFolder className="file-icon" size={15} />
                <span className="file-name-text">..</span>
              </button>
            )}
            {listing.entries.map((e) =>
              e.type === 'dir' ? (
                <div key={e.path} className="file-item dir">
                  <button type="button" className="file-dir-main" onClick={() => void load(e.path)}>
                    <FiFolder className="file-icon" size={15} />
                    <span className="file-name-text" title={e.path}>{e.name}</span>
                  </button>
                  <button
                    type="button"
                    className="file-attach ref"
                    data-tip="提及文件夹（随下一条消息发送）"
                    onClick={() => mention({ path: e.path, name: e.name, mode: 'reference', isDir: true })}
                  >
                    <FiLink size={12} />
                  </button>
                </div>
              ) : (
                <div key={e.path} className="file-item file">
                  <button
                    type="button"
                    className="file-name"
                    title={`${e.path} — 预览/编辑`}
                    onClick={() => setPreview({ path: e.path, name: e.name })}
                  >
                    <FiFile className="file-icon" size={14} />
                    <span className="file-name-text">{e.name}</span>
                    <span className="file-size">{formatSize(e.size)}</span>
                  </button>
                  <button
                    type="button"
                    className="file-attach download"
                    data-tip="下载"
                    onClick={(ev) => download(ev, e.path, e.name)}
                  >
                    <FiDownload size={12} />
                  </button>
                  <button
                    type="button"
                    className="file-attach inline"
                    data-tip="提及文件（随下一条消息发送）"
                    onClick={() => mention({ path: e.path, name: e.name, mode: 'inline' })}
                  >
                    <FiPlus size={13} />
                  </button>
                </div>
              ),
            )}
          </>
        )}
        {!loading && !error && cwd && !listing && <div className="panel-empty">目录不可读</div>}
      </div>

      {preview && (
        <FilePreview
          cwd={cwd}
          path={preview.path}
          name={preview.name}
          onClose={() => setPreview(null)}
          onSaved={() => setSavedTick((t) => t + 1)}
        />
      )}
    </div>
  )
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}
