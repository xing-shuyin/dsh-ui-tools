/** Thin typed fetch helpers for the dsh-ui-tools host routes. */

export interface FileEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size: number
  mtime: number
}

export interface FileListing {
  path: string
  parent: string | null
  entries: FileEntry[]
  truncated: boolean
}

export interface FileContent {
  path: string
  name: string
  text: string
  truncated: boolean
  binary: boolean
  kind: 'text' | 'image' | 'video' | 'none'
  lines: number
  size: number
}

export interface CommandDef {
  name: string
  command: string
  cwd?: string
}

export interface ScmStatus {
  branch: string
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  upstreamGone: boolean
  files: ScmFile[]
}

export interface ScmFile {
  path: string
  x: string
  y: string
}

export interface ScmBranch {
  name: string
  current: boolean
}

export interface ScmCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
  decorations: string
  graph: string
}

export async function api<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: opts?.method || 'GET',
    headers: opts?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body && typeof body.error === 'string') msg = body.error
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export function rawUrl(cwd: string, path: string): string {
  return `/dsh-ui-tools/api/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`
}

export function encodeCwd(cwd: string): string {
  return encodeURIComponent(cwd)
}
