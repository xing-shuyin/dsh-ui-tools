/**
 * Git panel — ported from pi-web-ui web/src/components/SCMPanel.tsx.
 * Read queries (status / branches / diff / log) run directly on the host;
 * write operations (commit / push / pull / branch switch) open a visible
 * terminal tab that runs the command, so the user can watch and interrupt.
 */
import * as React from 'react'
import { api, type ScmBranch, type ScmCommit, type ScmFile, type ScmStatus } from './api'
import { FiArrowDown, FiArrowUp, FiCheck, FiGitBranch, FiRefreshCw, FiTerminal } from './icons'
import {
  cleanSection, fileKind, KIND_LABELS, mergeStats, parseBranches,
  parseCommitHistory, parseStatus, type StatInfo,
} from './git-parse'
import { panelStore, termStore, type TermTab } from './store'

interface GitViewProps {
  cwd: string
  /** True when the panel is too narrow for side-by-side files+diff. */
  narrow?: boolean
}

type ViewMode = 'changes' | 'history'

const GIT = ['git', '-c', 'color.ui=false', '--no-pager']

export function GitView({ cwd, narrow = false }: GitViewProps) {
  const [status, setStatus] = React.useState<ScmStatus | null>(null)
  const [branches, setBranches] = React.useState<ScmBranch[]>([])
  const [branchSel, setBranchSel] = React.useState('')
  const [statMap, setStatMap] = React.useState<Map<string, StatInfo>>(new Map())
  const [viewMode, setViewMode] = React.useState<ViewMode>('changes')
  const [history, setHistory] = React.useState<ScmCommit[]>([])
  const [selectedCommit, setSelectedCommit] = React.useState<ScmCommit | null>(null)
  const [commitDetail, setCommitDetail] = React.useState('')
  const [commitLoading, setCommitLoading] = React.useState(false)
  const [selected, setSelected] = React.useState<ScmFile | null>(null)
  const [fileDiff, setFileDiff] = React.useState<{ file: ScmFile; staged: string; worktree: string; untracked: boolean } | null>(null)
  const [diffLoading, setDiffLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notRepo, setNotRepo] = React.useState(false)
  const [commitMsg, setCommitMsg] = React.useState('')

  const query = React.useCallback(async (commands: string[][]): Promise<string[]> => {
    const r = await api<{ outputs: string[] }>('/dsh-ui-tools/api/git/query', {
      method: 'POST',
      body: { cwd, commands },
    })
    return (r.outputs || []).map((s) => cleanSection(s))
  }, [cwd])

  const refresh = React.useCallback(async (manual = false) => {
    if (!cwd) return
    setBusy(true)
    setError(null)
    try {
      const outputs = await query([
        [...GIT, 'status', '--porcelain=v1', '-b'],
        [...GIT, 'branch', '--list'],
        [...GIT, 'diff', '--stat'],
        [...GIT, 'diff', '--cached', '--stat'],
        [...GIT, 'log', '--all', '--graph', '--decorate=short', '--date=short', '--pretty=format:%H%x09%h%x09%an%x09%ad%x09%s%x09%D', '-n', '120'],
      ])
      const [statusText, branchText, statText, cachedStatText, historyText] = outputs
      const notRepo = /not a git repository/i.test(statusText) || /\[git error\]/.test(statusText)
      setNotRepo(notRepo)
      if (notRepo) {
        setStatus(null)
        setBranches([])
        setStatMap(new Map())
        setHistory([])
        setSelectedCommit(null)
        setCommitDetail('')
        setFileDiff(null)
        return
      }
      const st = parseStatus(statusText)
      const branches = parseBranches(branchText)
      const stats = mergeStats([statText, cachedStatText])
      setStatus(st)
      setBranches(branches)
      setStatMap(stats)
      setBranchSel((prev) => {
        if (st.detached) return prev || ''
        const cur = st.branch
        if (cur && branches.some((b) => b.name === cur)) return cur
        if (prev && branches.some((b) => b.name === prev)) return prev
        return branches[0]?.name ?? ''
      })
      setHistory(parseCommitHistory(historyText))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
    void manual
  }, [cwd, query])

  React.useEffect(() => {
    if (cwd) void refresh(true)
  }, [cwd, refresh])

  const showFileDiff = async (f: ScmFile) => {
    setSelected(f)
    setSelectedCommit(null)
    if (f.x === '?' && f.y === '?') {
      setFileDiff({ file: f, staged: '', worktree: '', untracked: true })
      return
    }
    const esc = f.path.replace(/'/g, `'\\''`)
    setDiffLoading(true)
    setError(null)
    try {
      const [staged, worktree] = await query([
        [...GIT, 'diff', '--cached', '--', `'${esc}'`],
        [...GIT, 'diff', '--', `'${esc}'`],
      ])
      setFileDiff({ file: f, staged, worktree, untracked: false })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDiffLoading(false)
    }
  }

  const showCommitDetail = async (commit: ScmCommit) => {
    setSelectedCommit(commit)
    setSelected(null)
    setFileDiff(null)
    setCommitDetail('')
    setCommitLoading(true)
    setError(null)
    try {
      const esc = commit.hash.replace(/'/g, `'\\''`)
      const [detail] = await query([
        [...GIT, 'show', '--no-ext-diff', '--find-renames', '--format=fuller', '--stat', '--patch', `'${esc}'`],
      ])
      setCommitDetail(detail)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCommitLoading(false)
    }
  }

  // ---- write operations: run in a visible terminal tab -------------------

  const runGitCommand = (title: string, command: string) => {
    const tab: TermTab = {
      id: `git-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      title,
      cwd,
      command: { name: title, command, cwd: '${pwd}' },
      running: true,
      exitCode: null,
    }
    termStore.addTab(tab)
    panelStore.set({ open: true, tab: 'terminal' })
  }

  const handleCommit = () => {
    const msg = commitMsg.trim()
    if (!msg || notRepo) return
    const escaped = msg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$')
    runGitCommand('git commit', `git add -A && git commit -m "${escaped}"`)
    setCommitMsg('')
  }

  const handleSwitch = () => {
    if (!branchSel || notRepo) return
    runGitCommand('git checkout', `git checkout ${branchSel}`)
  }

  const handlePush = () => runGitCommand('git push', 'git push')
  const handlePull = () => runGitCommand('git pull', 'git pull')

  const renderDiff = (text: string) => {
    const lines = text.split('\n')
    return (
      <pre className="scm-diff-pre">
        {lines.map((ln, i) => {
          let cls = ''
          if (
            ln.startsWith('diff --git') || ln.startsWith('index ') || ln.startsWith('new file')
            || ln.startsWith('deleted file') || ln.startsWith('old mode') || ln.startsWith('new mode')
            || ln.startsWith('similarity index') || ln.startsWith('rename ') || ln.startsWith('copy ')
            || ln.startsWith('Binary files') || ln.startsWith('---') || ln.startsWith('+++')
          ) cls = 'hdr'
          else if (ln.startsWith('@@')) cls = 'hunk'
          else if (ln.startsWith('+')) cls = 'add'
          else if (ln.startsWith('-')) cls = 'del'
          return (
            <div key={i} className={`scm-diff-line ${cls}`}>{ln || ' '}</div>
          )
        })}
      </pre>
    )
  }

  return (
    <div className={`ut-view${narrow ? " narrow" : ""}`} data-ut-view="git">
      <div className="scm-view">
        <div className="scm-header">
          <div className="scm-row">
            <span className="scm-branch-current">
              <FiGitBranch size={14} />
              {status ? (status.detached ? 'HEAD（游离）' : status.branch) : '…'}
              {status?.upstream && (
                <span className="scm-upstream">
                  {status.upstreamGone
                    ? '（上游已删除）'
                    : status.ahead > 0 || status.behind > 0
                      ? `↑${status.ahead} ↓${status.behind}`
                      : status.upstream}
                </span>
              )}
            </span>
            <select
              className="scm-select"
              value={branchSel}
              disabled={notRepo || branches.length === 0}
              title="切换分支"
              onChange={(e) => setBranchSel(e.target.value)}
            >
              <option value="" disabled>选择分支…</option>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>{b.current ? `* ${b.name}` : b.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={!branchSel || branchSel === status?.branch || notRepo}
              title={`切换到 ${branchSel}`}
              onClick={handleSwitch}
            >
              <FiGitBranch size={14} /> 切换
            </button>
            <button type="button" className="btn" disabled={!status || status.detached || notRepo} title="git push" onClick={handlePush}>
              ↑ 推送
            </button>
            <button type="button" className="btn" disabled={!status || status.detached || notRepo} title="git pull" onClick={handlePull}>
              ↓ 拉取
            </button>
            <button type="button" className="btn" disabled={busy} title="刷新" onClick={() => void refresh(true)}>
              <FiRefreshCw size={13} className={busy ? 'scm-spin' : ''} />
            </button>
          </div>
          <div className="scm-row">
            <input
              className="scm-commit-input"
              value={commitMsg}
              placeholder="提交信息（git add -A && git commit）"
              disabled={notRepo}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleCommit()
              }}
            />
            <button type="button" className="btn primary" disabled={!commitMsg.trim() || notRepo} onClick={handleCommit}>
              ✓ 提交
            </button>
          </div>
        </div>

        {error && <div className="scm-error">{error}</div>}

        <div className="scm-body">
          <div className="scm-files">
            <div className="scm-files-header">
              <span style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 }}
                  onClick={() => setViewMode('changes')}
                >
                  更改列表
                </button>
                <button
                  type="button"
                  style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 }}
                  onClick={() => setViewMode('history')}
                >
                  提交历史
                </button>
              </span>
              {viewMode === 'changes'
                ? status && status.files.length > 0 && <span>{status.files.length}</span>
                : history.length > 0 && <span>{history.length}</span>}
            </div>
            <div className="scm-files-list">
              {notRepo ? (
                <div className="scm-empty">不是 Git 仓库</div>
              ) : viewMode === 'changes' ? (
                !status ? (
                  <div className="scm-empty">加载中…</div>
                ) : status.files.length === 0 ? (
                  <div className="scm-empty">没有更改</div>
                ) : (
                  status.files.map((f) => {
                    const kind = fileKind(f)
                    const st = statMap.get(f.path)
                    return (
                      <div
                        key={f.path}
                        className={`scm-file ${selected?.path === f.path ? 'active' : ''}`}
                        title={KIND_LABELS[kind]}
                        onClick={() => void showFileDiff(f)}
                      >
                        <span className={`scm-file-xy ${kind === 'untracked' ? 'q' : 'x'}`}>{f.x !== ' ' ? f.x : '\u00a0'}</span>
                        <span className={`scm-file-xy ${kind === 'untracked' ? 'q' : 'y'}`}>{f.y !== ' ' ? f.y : '\u00a0'}</span>
                        <span className="scm-file-path">{f.path}</span>
                        {st && (st.add > 0 || st.del > 0) && (
                          <span className="scm-file-stat">
                            {st.add > 0 && <span className="add">+{st.add}</span>}
                            {st.del > 0 && <span className="del">-{st.del}</span>}
                          </span>
                        )}
                      </div>
                    )
                  })
                )
              ) : history.length === 0 ? (
                <div className="scm-empty">没有提交历史</div>
              ) : (
                history.map((commit) => (
                  <button
                    key={commit.hash}
                    type="button"
                    className={`scm-commit ${selectedCommit?.hash === commit.hash ? 'active' : ''}`}
                    onClick={() => void showCommitDetail(commit)}
                    title={commit.hash}
                  >
                    <span className="scm-commit-graph">{commit.graph || '* '}</span>
                    <span className="scm-commit-info">
                      <span className="scm-commit-subject">{commit.subject}</span>
                      <span className="scm-commit-meta">
                        {commit.shortHash} · {commit.author} · {commit.date}
                        {commit.decorations ? ` · ${commit.decorations}` : ''}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="scm-diff">
            <div className="scm-diff-header">
              <span>
                {viewMode === 'history'
                  ? selectedCommit ? `${selectedCommit.shortHash} ${selectedCommit.subject}` : '提交详情'
                  : selected ? selected.path : '差异'}
              </span>
              {(viewMode === 'history' ? commitLoading : diffLoading) && <span>加载中…</span>}
            </div>
            <div className="scm-diff-body">
              {viewMode === 'history' ? (
                <>
                  {!selectedCommit && <div className="scm-empty">点击左侧提交查看详情</div>}
                  {selectedCommit && commitLoading && <div className="scm-empty">加载中…</div>}
                  {selectedCommit && !commitLoading && commitDetail ? renderDiff(commitDetail) : null}
                </>
              ) : (
                <>
                  {!selected && <div className="scm-empty">点击左侧文件查看差异</div>}
                  {selected && !fileDiff && !diffLoading && <div className="scm-empty">加载中…</div>}
                  {selected && fileDiff && fileDiff.untracked && <div className="scm-empty">未跟踪的新文件，暂无差异</div>}
                  {selected && fileDiff && !fileDiff.untracked && (
                    <>
                      {fileDiff.staged && (
                        <>
                          <div className="scm-diff-header" style={{ borderBottom: 'none', padding: '4px 10px' }}>已暂存</div>
                          {renderDiff(fileDiff.staged)}
                        </>
                      )}
                      {fileDiff.worktree && (
                        <>
                          <div className="scm-diff-header" style={{ borderBottom: 'none', padding: '4px 10px' }}>未暂存</div>
                          {renderDiff(fileDiff.worktree)}
                        </>
                      )}
                      {!fileDiff.staged && !fileDiff.worktree && <div className="scm-empty">无差异</div>}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="scm-hint">
          <FiTerminal size={13} />
          <span>写操作（提交 / 推送 / 拉取 / 切换分支）会在「终端」标签页中运行，可实时查看输出。</span>
        </div>
      </div>
    </div>
  )
}
