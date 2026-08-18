/**
 * File preview modal — ported from pi-web-ui web/src/components/FilePreview.tsx.
 * Text files get a line-numbered view with click/drag line selection,
 * an opt-in edit mode (Ctrl/Cmd+S to save), and Markdown files open in a
 * rendered preview with a one-click source toggle. Images/videos stream from
 * the host raw route; binary files show a hex dump. The 提及 buttons add the
 * whole file or the selected line range to the mention strip.
 */
import * as React from 'react'
import { api, rawUrl, type FileContent } from './api'
import { mentionStore } from './store'
import { isMarkdownFile } from './FilesView'
import { renderMarkdown } from './markdown'
import { FiCheck, FiCode, FiCornerDownLeft, FiEdit3, FiEye, FiLink, FiPlus, FiSave, FiX } from './icons'

const MAX_PREVIEW_LINES = 5000

interface FilePreviewProps {
  cwd: string
  path: string
  name: string
  onClose: () => void
  onSaved?: () => void
}

interface Range {
  start: number
  end: number
}

export function FilePreview({ cwd, path, name, onClose, onSaved }: FilePreviewProps) {
  const [loaded, setLoaded] = React.useState<FileContent | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [sel, setSel] = React.useState<Range | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [added, setAdded] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [markdownPreview, setMarkdownPreview] = React.useState(true)
  const [wrap, setWrap] = React.useState(true)
  const anchorRef = React.useRef(0)
  const draggingRef = React.useRef(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoaded(null)
    setSel(null)
    setEditing(false)
    setMarkdownPreview(true)
    try {
      const content = await api<FileContent>(
        `/dsh-ui-tools/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
      )
      setLoaded(content)
      setDraft(content.text)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [cwd, path])

  React.useEffect(() => {
    void load()
  }, [load])

  // Escape closes; Ctrl/Cmd+S saves while editing.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && editing) {
        e.preventDefault()
        void save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, editing, loaded, draft])

  const lines = React.useMemo(() => {
    if (!loaded) return []
    const parts = loaded.text.split('\n')
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
    return parts.slice(0, MAX_PREVIEW_LINES)
  }, [loaded])

  const lineCount = loaded?.lines ?? 0
  const truncatedLines = lineCount > MAX_PREVIEW_LINES
  const isBinary = loaded?.binary ?? false
  const kind = loaded?.kind ?? 'text'
  const isMarkdown = isMarkdownFile(name)
  const showMarkdown = isMarkdown && markdownPreview && !editing && kind === 'text' && !isBinary
  const canEdit = loaded !== null && loaded.kind === 'text' && !loaded.binary && !loaded.truncated

  const selectLine = (line: number, extend: boolean) => {
    if (extend) {
      const anchor = anchorRef.current > 0 ? anchorRef.current : line
      setSel({ start: Math.min(anchor, line), end: Math.max(anchor, line) })
    } else {
      anchorRef.current = line
      setSel({ start: line, end: line })
    }
  }

  const selectAll = () => {
    if (lines.length === 0) return
    anchorRef.current = 1
    setSel({ start: 1, end: lines.length })
  }

  const save = async () => {
    if (!editing) return
    try {
      await api('/dsh-ui-tools/api/file', { method: 'POST', body: { cwd, path, text: draft } })
      setEditing(false)
      setMarkdownPreview(true)
      setSel(null)
      onSaved?.()
      void load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const toggleEditing = () => {
    if (editing) {
      if (draft !== (loaded?.text ?? '') && !window.confirm('放弃未保存的修改？')) return
      setDraft(loaded?.text ?? '')
      setEditing(false)
      if (isMarkdown) setMarkdownPreview(true)
      return
    }
    if (!canEdit || !loaded) return
    if (isMarkdown) setMarkdownPreview(false)
    setSel(null)
    setDraft(loaded.text)
    setEditing(true)
  }

  const addWholeFile = () => {
    mentionStore.add({ path, name, mode: 'inline' })
    setAdded(true)
    setTimeout(() => setAdded(false), 1400)
  }

  const addLines = () => {
    if (!sel) return
    mentionStore.add({ path, name, mode: 'lines', lines: { start: sel.start, end: sel.end } })
    setAdded(true)
    setTimeout(() => setAdded(false), 1400)
  }

  const selCount = sel ? sel.end - sel.start + 1 : 0

  return (
    <div
      className="fp-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="fp">
        <div className="fp-head">
          <span className="fp-name">{name}</span>
          <span className="fp-path">{path}</span>
          <span className="fp-meta">
            {loaded && kind === 'text' && !isBinary && `${lineCount} 行 · `}
            {loaded && formatSize(loaded.size)}
          </span>
          <div className="fp-head-actions">
            {isMarkdown && kind === 'text' && !isBinary && loaded && (
              <button
                type="button"
                className={`fp-attach wrap ${markdownPreview ? 'on' : ''}`}
                data-tip={markdownPreview ? '显示源码' : '显示预览'}
                disabled={editing}
                onClick={() => setMarkdownPreview((v) => !v)}
              >
                {markdownPreview ? React.createElement(FiCode, { size: 13 }) : React.createElement(FiEye, { size: 13 })}
              </button>
            )}
            {kind === 'text' && !isBinary && loaded && (
              <button
                type="button"
                className={`fp-attach edit ${editing ? 'on' : ''}`}
                data-tip={truncatedLines ? '文件过大，无法编辑' : editing ? '退出编辑' : '编辑'}
                disabled={!canEdit && !editing}
                onClick={toggleEditing}
              >
                <FiEdit3 size={13} />
              </button>
            )}
            {kind === 'text' && !isBinary && !showMarkdown && (
              <button
                type="button"
                className={`fp-attach wrap ${wrap ? 'on' : ''}`}
                data-tip={wrap ? '关闭自动换行' : '开启自动换行'}
                onClick={() => setWrap((w) => !w)}
              >
                <FiCornerDownLeft size={13} />
              </button>
            )}
            <button
              type="button"
              className="fp-attach inline"
              data-tip="提及文件（随下一条消息发送）"
              onClick={addWholeFile}
            >
              <FiPlus size={13} />
            </button>
            <button type="button" className="fp-close" title="关闭" onClick={onClose}>
              <FiX size={14} />
            </button>
          </div>
        </div>

        <div className="fp-body">
          {error && <div className="panel-empty" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>{error}</div>}
          {loading && !loaded && <div className="panel-empty"><span className="spinner" /></div>}

          {!loading && kind === 'image' && (
            <div className="fp-media-wrap">
              <img className="fp-media" src={rawUrl(cwd, path)} alt={name} />
            </div>
          )}
          {!loading && kind === 'video' && (
            <div className="fp-media-wrap">
              <video className="fp-media" src={rawUrl(cwd, path)} controls preload="metadata" />
            </div>
          )}
          {!loading && showMarkdown && loaded && (
            <div
              className="fp-markdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(loaded.text) }}
            />
          )}
          {!loading && isBinary && kind !== 'image' && kind !== 'video' && loaded && (
            <pre className="fp-hex">{loaded.text}</pre>
          )}
          {!loading && editing && kind === 'text' && !isBinary && loaded && (
            <textarea
              className="fp-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              autoFocus
            />
          )}
          {!loading && !showMarkdown && !editing && kind === 'text' && !isBinary && loaded && lines.length === 0 && (
            <div className="panel-empty">（空文件）</div>
          )}
          {!loading && !showMarkdown && !editing && kind === 'text' && !isBinary && loaded && lines.length > 0 && (
            <div
              className="fp-code"
              style={{ padding: '6px 0' }}
              onMouseDown={(e) => {
                if (e.button === 0) e.preventDefault()
              }}
            >
              {lines.map((text, i) => {
                const n = i + 1
                const active = sel !== null && n >= sel.start && n <= sel.end
                return (
                  <div
                    key={n}
                    className={`fp-line ${active ? 'sel' : ''}`}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return
                      selectLine(n, e.shiftKey)
                      draggingRef.current = true
                      setDragging(true)
                    }}
                    onMouseEnter={() => {
                      if (draggingRef.current) selectLine(n, true)
                    }}
                  >
                    <span className="fp-num">{n}</span>
                    <span className="fp-code-text" style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>{text}</span>
                  </div>
                )
              })}
              {truncatedLines && (
                <div className="panel-empty">仅显示前 {MAX_PREVIEW_LINES} 行</div>
              )}
            </div>
          )}
        </div>

        <div className="fp-foot">
          {editing ? (
            <>
              <span className="fp-hint">编辑中 — Ctrl/Cmd+S 保存</span>
              <div className="fp-actions">
                <button type="button" className="btn" onClick={toggleEditing}>取消</button>
                <button type="button" className="btn primary" disabled={draft === (loaded?.text ?? '')} onClick={() => void save()}>
                  <FiSave size={13} /> 保存
                </button>
              </div>
            </>
          ) : (
            !showMarkdown && kind === 'text' && (
              <>
                <span className="fp-hint">
                  {sel
                    ? `已选 ${selCount} 行（${sel.start}–${sel.end}）`
                    : '点击/拖动选择行，可把选中行提及给 Agent'}
                </span>
                <div className="fp-actions">
                  <button type="button" className="btn" disabled={lines.length === 0} onClick={selectAll}>全选</button>
                  <button type="button" className="btn" disabled={!sel} onClick={() => setSel(null)}>清除</button>
                  <button type="button" className="btn primary" disabled={!sel || isBinary} onClick={addLines}>
                    {added ? React.createElement(FiCheck, { size: 13 }) : null}
                    {added ? ' 已加入' : ' 提及选中行'}
                  </button>
                </div>
              </>
            )
          )}
        </div>
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
