/**
 * Git output parsers — ported from pi-web-ui web/src/components/SCMPanel.tsx
 * (cleanSection / parseStatus / parseBranches / parseCommitHistory /
 * mergeStats / fileKind). Git runs with color disabled, so ANSI is rare, but
 * the cleaner is kept for safety.
 */

import type { ScmBranch, ScmCommit, ScmFile, ScmStatus } from './api'

export function cleanSection(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '')
    .replace(/\x1b[=>]/g, '')
    .split(/\r?\n|\r/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0)
    .join('\n')
}

function unquotePath(s: string): string {
  if (!s.startsWith('"')) return s
  const inner = s.endsWith('"') ? s.slice(1, -1) : s.slice(1)
  return inner.replace(/\\(.)/g, (_m: string, c: string) => {
    switch (c) {
      case 'n': return '\n'
      case 't': return '\t'
      case 'r': return '\r'
      case 'b': return '\b'
      case 'a': return '\a'
      case 'f': return '\f'
      case 'v': return '\v'
      default: return c
    }
  })
}

function parseStatusHeader(rest: string, out: ScmStatus): void {
  let branchPart = rest
  let flags = ''
  const bi = rest.indexOf(' [')
  if (bi >= 0) {
    branchPart = rest.slice(0, bi)
    flags = rest.slice(bi + 2)
    if (flags.endsWith(']')) flags = flags.slice(0, -1)
  }
  if (branchPart === 'HEAD (no branch)' || branchPart === 'HEAD') {
    out.detached = true
    out.branch = 'HEAD'
  } else {
    if (branchPart.startsWith('No commits yet on ')) {
      branchPart = branchPart.slice('No commits yet on '.length)
    }
    const up = branchPart.indexOf('...')
    if (up >= 0) {
      out.branch = branchPart.slice(0, up)
      out.upstream = branchPart.slice(up + 3)
    } else {
      out.branch = branchPart
    }
  }
  if (flags) {
    for (const part of flags.split(',')) {
      const p = part.trim()
      const m = p.match(/^(ahead|behind) (\d+)$/)
      if (m) {
        if (m[1] === 'ahead') out.ahead = Number(m[2])
        else out.behind = Number(m[2])
      } else if (p === 'gone') {
        out.upstreamGone = true
      }
    }
  }
}

export function parseStatus(text: string): ScmStatus {
  const out: ScmStatus = {
    branch: 'HEAD', detached: false, upstream: null,
    ahead: 0, behind: 0, upstreamGone: false, files: [],
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line) continue
    if (line.startsWith('## ')) {
      parseStatusHeader(line.slice(3), out)
      continue
    }
    if (line.length >= 3) {
      let path = line.slice(3)
      const arrow = path.indexOf(' -> ')
      if (arrow >= 0) path = path.slice(arrow + 4)
      out.files.push({ path: unquotePath(path), x: line[0], y: line[1] })
    }
  }
  return out
}

export function parseBranches(text: string): ScmBranch[] {
  const out: ScmBranch[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^([*+ ]) (.+)$/)
    if (!m) continue
    const name = m[2].trim()
    if (!name || name.startsWith('(')) continue
    out.push({ name, current: m[1] === '*' })
  }
  return out
}

export function parseCommitHistory(text: string): ScmCommit[] {
  const out: ScmCommit[] = []
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const prefixAndHash = line.slice(0, tab)
    const match = prefixAndHash.match(/([0-9a-f]{7,40})$/i)
    if (!match || match.index === undefined) continue
    const fields = line.slice(tab + 1).split('\t')
    if (fields.length < 4) continue
    out.push({
      hash: match[1],
      shortHash: fields[0],
      author: fields[1],
      date: fields[2],
      subject: fields[3],
      decorations: fields[4] ?? '',
      graph: prefixAndHash.slice(0, match.index),
    })
  }
  return out
}

export interface StatInfo { add: number; del: number }

export function mergeStats(sections: string[]): Map<string, StatInfo> {
  const map = new Map<string, StatInfo>()
  for (const section of sections) {
    for (const line of section.split('\n')) {
      if (!line) continue
      const m = line.match(/^\s*(\S.*?)\s+\|\s+(\d+)\s+([+\-\s]+)\s*$/)
      if (!m) continue
      let add = 0
      let del = 0
      for (const c of m[3]) {
        if (c === '+') add++
        else if (c === '-') del++
      }
      const path = unquotePath(m[1].trim())
      const prev = map.get(path)
      map.set(path, { add: (prev?.add ?? 0) + add, del: (prev?.del ?? 0) + del })
    }
  }
  return map
}

export type FileKind = 'staged' | 'unstaged' | 'untracked' | 'both'

export function fileKind(f: ScmFile): FileKind {
  if (f.x === '?' && f.y === '?') return 'untracked'
  const staged = f.x !== ' ' && f.x !== '?'
  const unstaged = f.y !== ' ' && f.y !== '?'
  if (staged && unstaged) return 'both'
  if (staged) return 'staged'
  return 'unstaged'
}

export const KIND_LABELS: Record<FileKind, string> = {
  staged: '已暂存',
  unstaged: '未暂存',
  untracked: '未跟踪',
  both: '暂存+未暂存',
}
