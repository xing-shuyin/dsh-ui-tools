/**
 * dsh-ui-tools — Host half.
 *
 * A dsh web plugin that adds a developer panel (files / terminal / git) to
 * the DeepSeek Harness web UI. The business logic is ported from pi-web-ui
 * (server/terminals.ts + the file/git parts of server/agent-service.ts):
 *
 *   - File browsing / preview / save over HTTP routes (path-traversal safe).
 *   - Multiple PTY terminals (node-pty, one shell per tab) streamed to the
 *     browser over SSE; input/resize/signal/kill over POST routes. Quick
 *     commands are persisted per workspace in `.dsh-ui-tools/commands.json`
 *     (port of pi-web-ui's `.pi/commands.json`).
 *   - Git read queries (status/branch/log/diff) executed directly; write ops
 *     (commit/push/pull/checkout) run in a visible terminal tab.
 *   - File mentions: the client keeps a per-session "mention" list (files the
 *     user picked to ride along with the next question). When the agent's
 *     next step claims the user message, this plugin enriches that message
 *     with the mentioned files' content, then clears the list.
 *
 * The package root export is this module; the loader imports it by name.
 */
import { spawn } from 'node-pty'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  chmodSync, existsSync, readdirSync, statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import {
  dirname, extname, isAbsolute, join, relative, resolve, sep,
} from 'node:path'

export const name = 'dsh-ui-tools'

// ---------------------------------------------------------------------------
// constants (ported from pi-web-ui)
// ---------------------------------------------------------------------------

const MAX_PREVIEW_BYTES = 512 * 1024
const MAX_SAVE_BYTES = 2 * 1024 * 1024
const MAX_MENTION_BYTES = 512 * 1024
const MAX_MENTION_FILES = 50
const COMMANDS_DIR = '.dsh-ui-tools'
const COMMANDS_FILE = 'commands.json'

const PREVIEW_IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'jfif', 'tif', 'tiff',
])
const PREVIEW_VIDEO_EXTS = new Set([
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv', 'mpg', 'mpeg', 'wmv', 'flv',
])
const PREVIEW_TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf',
  'log', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'py', 'rb', 'go', 'rs',
  'java', 'kt', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'php', 'sql', 'graphql',
  'vue', 'svelte', 'astro', 'lock', 'env', 'gitignore', 'editorconfig', 'dockerfile',
  'makefile', 'cmake', 'gradle', 'properties', 'csv', 'tsv', 'diff', 'patch',
])
const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  avif: 'image/avif', jfif: 'image/jpeg', tif: 'image/tiff', tiff: 'image/tiff',
}
const VIDEO_MIME = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', m4v: 'video/mp4', ogv: 'video/ogg', mpg: 'video/mpeg',
  mpeg: 'video/mpeg', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
}

const IGNORED_ENTRIES = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', '.next', '.nuxt', '.cache',
  '.venv', 'venv', '__pycache__', 'coverage', '.pi-web', '.DS_Store', 'Thumbs.db',
])

const isWindows = process.platform === 'win32'

// ---------------------------------------------------------------------------
// helpers (ported from pi-web-ui server/agent-service.ts)
// ---------------------------------------------------------------------------

/** Resolve a workspace-relative path, refusing ".." traversal. */
function workspacePath(root, raw) {
  const abs = resolve(root, raw || '.')
  const rawRel = relative(root, abs)
  if (rawRel.startsWith('..') || rawRel.includes(`${sep}..`)) return null
  return { abs, rel: rawRel.split(sep).join('/') }
}

function previewKind(name) {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (PREVIEW_IMAGE_EXTS.has(ext)) return 'image'
  if (PREVIEW_VIDEO_EXTS.has(ext)) return 'video'
  if (ext === '' || PREVIEW_TEXT_EXTS.has(ext)) return 'text'
  return 'none'
}

function looksLikeText(buf) {
  if (buf.length === 0) return true
  if (buf.includes(0)) return false
  const text = buf.toString('utf8')
  let control = 0
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 12 && c !== 13) control++
  }
  return control / Math.max(text.length, 1) < 0.02
}

function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf)
    } catch {
      return buf.toString('latin1')
    }
  }
}

function hexDump(buf, maxBytes = 4096) {
  const data = buf.subarray(0, Math.min(buf.length, maxBytes))
  const rows = []
  for (let off = 0; off < data.length; off += 16) {
    const chunk = data.subarray(off, off + 16)
    const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = [...chunk]
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
      .join('')
    rows.push(`${off.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`)
  }
  return rows.join('\n')
}

function countLines(buf) {
  if (buf.length === 0) return 0
  const hasTrailingNewline = buf[buf.length - 1] === 10
  let lines = 0
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines++
  return hasTrailingNewline ? lines : lines + 1
}

async function readDirForUI(abs) {
  const { readdir, stat } = await import('node:fs/promises')
  let dirents
  try {
    dirents = await readdir(abs, { withFileTypes: true })
  } catch (err) {
    return { entries: [], truncated: false, error: err.message }
  }
  // No entry cap: the user asked for the full listing ("不要截断文件列表全显示").
  const out = []
  for (const d of dirents) {
    if (IGNORED_ENTRIES.has(d.name)) continue
    let type = 'file'
    try {
      if (d.isDirectory()) type = 'dir'
      else if (d.isSymbolicLink()) {
        const st = await stat(join(abs, d.name))
        type = st.isDirectory() ? 'dir' : 'file'
      }
    } catch {
      type = 'file'
    }
    out.push({ name: d.name, type })
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return { entries: out, truncated: false }
}

// ---------------------------------------------------------------------------
// quick commands (port of pi-web-ui server/terminals.ts)
// ---------------------------------------------------------------------------

function commandsFilePath(root) {
  return join(root, COMMANDS_DIR, COMMANDS_FILE)
}

function expandPwd(input, pwd) {
  let out = input.replace(/\$\{pwd\}/g, pwd)
  if (out === '~') return homedir()
  if (out.startsWith('~/')) out = join(homedir(), out.slice(2))
  return out
}

function resolveCommandCwd(cwd, pwd) {
  if (!cwd || cwd.trim() === '') return pwd
  const expanded = expandPwd(cwd.trim(), pwd)
  return isAbsolute(expanded) ? expanded : resolve(pwd, expanded)
}

async function loadCommands(root) {
  const path = commandsFilePath(root)
  try {
    if (!existsSync(path)) return { commands: [], path, warning: undefined }
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed && Array.isArray(parsed.commands) ? parsed.commands : [])
    const commands = list
      .filter((c) => c && typeof c === 'object' && typeof c.name === 'string' && typeof c.command === 'string')
      .map((c) => ({ name: c.name, command: c.command, cwd: c.cwd }))
    return { commands, path, warning: undefined }
  } catch (err) {
    return { commands: [], path, warning: `命令文件读取失败：${err.message}` }
  }
}

async function saveCommands(root, commands) {
  const path = commandsFilePath(root)
  await mkdir(join(root, COMMANDS_DIR), { recursive: true })
  await writeFile(path, JSON.stringify({ commands }, null, 2) + '\n', 'utf8')
  return { path }
}

// ---------------------------------------------------------------------------
// terminal manager (port of pi-web-ui server/terminals.ts, HTTP/SSE transport)
// ---------------------------------------------------------------------------

/** The terminal manager owns one PTY per tab and fans output to SSE clients. */
class TerminalManager {
  constructor() {
    /** id -> entry */
    this.terms = new Map()
    this.seq = 0
    this.gcTimer = null
  }

  start() {
    // GC: a terminal with no SSE connection and no heartbeat for 60s is killed.
    this.gcTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, entry] of this.terms) {
        if (entry.exited) continue
        if (entry.connections.size === 0 && now - entry.lastSeen > 60_000) {
          this.kill(id)
        }
      }
    }, 15_000)
  }

  stop() {
    if (this.gcTimer) clearInterval(this.gcTimer)
    this.gcTimer = null
    this.killAll()
  }

  resolveShell() {
    if (isWindows) {
      const explicit = process.env.PI_WEB_SHELL
      if (explicit) return { shell: explicit, args: bashArgs(explicit) }
      const she = process.env.SHELL
      if (she && existsSync(she)) return { shell: she, args: bashArgs(she) }
      const pf = process.env.ProgramFiles
      const pf86 = process.env['ProgramFiles(x86)']
      for (const cand of [pf ? join(pf, 'Git', 'bin', 'bash.exe') : '', pf86 ? join(pf86, 'Git', 'bin', 'bash.exe') : '']) {
        if (cand && existsSync(cand)) return { shell: cand, args: ['-i'] }
      }
      const busybox = join(homedir(), '.pi-web', 'bin', 'bash.exe')
      if (existsSync(busybox)) return { shell: busybox, args: ['-i'] }
      return { shell: process.env.COMSPEC || 'powershell.exe', args: [] }
    }
    return { shell: process.env.SHELL || 'bash', args: ['-i'] }
  }

  shellEnv() {
    const env = { ...process.env, TERM: 'xterm-256color' }
    if (!env.LANG && !env.LC_ALL) env.LANG = 'en_US.UTF-8'
    return env
  }

  /** Create (or restart) a terminal, optionally running `command` in it. */
  create({ id, cwd, cols = 80, rows = 24, command, title }) {
    const existing = this.terms.get(id)
    if (existing) {
      if (!existing.exited) {
        existing.exited = true
        try { existing.pty.kill() } catch { /* already dead */ }
      }
      this.terms.delete(id)
    }
    const dir = command && command.cwd
      ? resolveCommandCwd(command.cwd, cwd)
      : cwd
    const abs = dir ? (isAbsolute(dir) ? dir : resolve(dir)) : homedir()
    if (!existsSync(abs)) {
      this.fail(id, `目录不存在：${abs}`)
      return false
    }
    repairSpawnHelperPermissions()
    let pty
    try {
      const { shell, args } = this.resolveShell()
      pty = spawn(shell, args, {
        name: 'xterm-256color',
        cols: Math.max(2, Math.floor(cols) || 80),
        rows: Math.max(2, Math.floor(rows) || 24),
        cwd: abs,
        env: this.shellEnv(),
      })
    } catch (err) {
      const helper = brokenSpawnHelper()
      this.fail(id, helper
        ? `启动终端失败：${err.message}（node-pty 的 spawn-helper 缺少执行权限，请运行：chmod +x "${helper}"）`
        : `启动终端失败：${err.message}`)
      return false
    }
    const entry = {
      id,
      pty,
      title: title || `终端 ${++this.seq}`,
      cwd: abs,
      cols: Math.max(2, Math.floor(cols) || 80),
      rows: Math.max(2, Math.floor(rows) || 24),
      exited: false,
      exitCode: null,
      buffer: '',
      connections: new Set(),
      lastSeen: Date.now(),
    }
    this.terms.set(id, entry)
    pty.onData((data) => {
      if (this.terms.get(id) !== entry || entry.exited) return
      entry.buffer += data
      if (entry.buffer.length > 512 * 1024) {
        entry.buffer = entry.buffer.slice(entry.buffer.length - 512 * 1024)
      }
      this.broadcast(id, { type: 'output', data })
    })
    pty.onExit(({ exitCode }) => {
      if (this.terms.get(id) !== entry || entry.exited) return
      entry.exited = true
      entry.exitCode = exitCode
      this.writeOut(id, `\r\n\x1b[90m[进程已退出，退出码 ${exitCode}]\x1b[0m\r\n`)
      this.broadcast(id, { type: 'exit', exitCode })
      for (const res of entry.connections) {
        try { res.end() } catch { /* ignore */ }
      }
      entry.connections.clear()
    })
    if (command && command.command) {
      const line = expandPwd(command.command.trim(), cwd)
      this.writeOut(id, '\x1b[2J\x1b[3J\x1b[H')
      this.writeOut(id, `\x1b[90m> ${line}\x1b[0m  \x1b[90m(${abs})\x1b[0m\r\n`)
      if (line) {
        // The PTY input buffer holds it until the shell is ready.
        setTimeout(() => { this.input(id, line + '\r') }, 150)
      }
    }
    return true
  }

  writeOut(id, data) {
    const entry = this.terms.get(id)
    if (!entry || entry.exited) return
    entry.buffer += data
    if (entry.buffer.length > 512 * 1024) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - 512 * 1024)
    }
    this.broadcast(id, { type: 'output', data })
  }

  broadcast(id, msg) {
    const entry = this.terms.get(id)
    if (!entry) return
    const payload = `data: ${JSON.stringify(msg)}\n\n`
    for (const res of entry.connections) {
      try { res.write(payload) } catch { /* closed */ }
    }
  }

  fail(id, text) {
    this.broadcast(id, { type: 'output', data: `\x1b[91m${text}\x1b[0m\r\n` })
    this.broadcast(id, { type: 'exit', exitCode: null })
    const entry = this.terms.get(id)
    if (entry) {
      entry.exited = true
      entry.exitCode = null
      for (const res of entry.connections) { try { res.end() } catch { /* ignore */ } }
      entry.connections.clear()
    }
    this.terms.delete(id)
  }

  /** Attach an SSE response to a terminal. Returns false when unknown. */
  attach(id, res) {
    const entry = this.terms.get(id)
    if (!entry) return false
    entry.connections.add(res)
    entry.lastSeen = Date.now()
    const init = {
      type: 'init',
      buffer: entry.buffer,
      exited: entry.exited,
      exitCode: entry.exitCode,
      cols: entry.cols,
      rows: entry.rows,
    }
    res.write(`data: ${JSON.stringify(init)}\n\n`)
    return true
  }

  detach(id, res) {
    const entry = this.terms.get(id)
    if (entry) entry.connections.delete(res)
  }

  input(id, data) {
    const entry = this.terms.get(id)
    if (entry && !entry.exited) entry.pty.write(data)
    if (entry) entry.lastSeen = Date.now()
  }

  resize(id, cols, rows) {
    const entry = this.terms.get(id)
    if (!entry || entry.exited) return
    try {
      entry.pty.resize(Math.max(2, Math.floor(cols) || 80), Math.max(2, Math.floor(rows) || 24))
      entry.cols = Math.max(2, Math.floor(cols) || 80)
      entry.rows = Math.max(2, Math.floor(rows) || 24)
    } catch { /* PTY gone */ }
    entry.lastSeen = Date.now()
  }

  signal(id, signal) {
    const entry = this.terms.get(id)
    if (!entry || entry.exited) return false
    try {
      const pgid = this.foregroundPgid(id)
      if (pgid !== undefined && pgid !== entry.pty.pid) {
        entry.pty.kill(signal)
      } else {
        entry.pty.kill(signal)
      }
      return true
    } catch { return false }
  }

  foregroundPgid(id) {
    // Best-effort: node-pty does not expose the foreground pgid directly.
    // Sending the signal through pty.kill targets the process group node-pty
    // manages, which is the shell's group — good enough for Ctrl-C semantics.
    const entry = this.terms.get(id)
    return entry ? entry.pty.pid : undefined
  }

  kill(id) {
    const entry = this.terms.get(id)
    if (!entry) return
    if (!entry.exited) {
      entry.exited = true
      try { entry.pty.kill() } catch { /* already dead */ }
      this.broadcast(id, { type: 'exit', exitCode: null })
    }
    for (const res of entry.connections) { try { res.end() } catch { /* ignore */ } }
    entry.connections.clear()
    this.terms.delete(id)
  }

  killAll() {
    for (const id of [...this.terms.keys()]) this.kill(id)
  }

  /** id -> {title, cwd, running, exitCode} */
  list() {
    return [...this.terms.entries()].map(([id, e]) => ({
      id, title: e.title, cwd: e.cwd, running: !e.exited, exitCode: e.exitCode,
    }))
  }
}

function bashArgs(shell) {
  return /[\\/]bash(\.exe)?$/i.test(shell) ? ['-i'] : []
}

// --- node-pty spawn-helper permission repair (port of pi-web-ui) -----------

const require = createRequire(import.meta.url)

function spawnHelperPaths() {
  try {
    const pkgDir = dirname(dirname(require.resolve('node-pty')))
    const out = []
    const built = join(pkgDir, 'build', 'Release', 'spawn-helper')
    if (existsSync(built)) out.push(built)
    const prebuildsDir = join(pkgDir, 'prebuilds')
    if (existsSync(prebuildsDir)) {
      for (const entry of readdirSync(prebuildsDir)) {
        const p = join(prebuildsDir, entry, 'spawn-helper')
        if (existsSync(p)) out.push(p)
      }
    }
    return out
  } catch { return [] }
}

function repairSpawnHelperPermissions() {
  if (isWindows) return
  for (const p of spawnHelperPaths()) {
    try {
      if ((statSync(p).mode & 0o111) === 0) chmodSync(p, 0o755)
    } catch { /* best-effort */ }
  }
}

function brokenSpawnHelper() {
  if (isWindows) return ''
  for (const p of spawnHelperPaths()) {
    try { if ((statSync(p).mode & 0o111) === 0) return p } catch { /* ignore */ }
  }
  return ''
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

/** Run one git command (argv array, no shell), bounded. */
function runGit(cwd, args, timeoutMs = 20_000) {
  return new Promise((resolvePromise) => {
    execFile('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        // `git` exits 1 with stderr for e.g. "not a git repository" — surface it.
        resolvePromise({ ok: false, error: String(stderr || err.message).trim() })
        return
      }
      resolvePromise({ ok: true, output: stdout })
    })
  })
}

/** Read one workspace file for the mention feature (capped). */
async function readMentionText(cwd, relPath) {
  const wp = workspacePath(cwd, relPath)
  if (!wp) return null
  const { open } = await import('node:fs/promises')
  const st = await statSyncSafe(wp.abs)
  if (!st || !st.isFile()) return null
  const handle = await open(wp.abs, 'r')
  try {
    const buf = Buffer.alloc(Math.min(st.size, MAX_MENTION_BYTES))
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    return { text: decodeText(buf.subarray(0, bytesRead)), truncated: bytesRead < st.size, size: st.size }
  } finally {
    await handle.close()
  }
}

async function statSyncSafe(p) {
  try { return statSync(p) } catch { return null }
}

// ---------------------------------------------------------------------------
// mention store + message enrichment
// ---------------------------------------------------------------------------

/** Build the text blocks attached to the user's message for the mentioned files. */
async function buildMentionBlocks(mention, cwd) {
  const blocks = []
  const files = (mention.files || []).slice(0, MAX_MENTION_FILES)
  for (const f of files) {
    const name = String(f.name || (f.path || '').split('/').pop() || f.path)
    if (f.mode === 'reference' || f.isDir) {
      blocks.push({ type: 'text', text: `[引用] ${f.path}` })
      continue
    }
    let content
    let truncated = false
    try {
      const read = await readMentionText(cwd, f.path)
      if (!read) {
        blocks.push({ type: 'text', text: `[文件] ${f.path}\n（读取失败或不存在）` })
        continue
      }
      content = read.text
      truncated = read.truncated
    } catch (err) {
      blocks.push({ type: 'text', text: `[文件] ${f.path}\n（读取失败：${err.message}）` })
      continue
    }
    if (f.mode === 'lines' && f.lines && f.lines.start >= 1) {
      const all = content.split('\n')
      const start = f.lines.start
      const end = Math.min(f.lines.end || start, all.length)
      content = all.slice(start - 1, end).join('\n')
    }
    const ext = extname(name).replace(/^\./, '')
    const cap = 256 * 1024
    if (content.length > cap) {
      content = content.slice(0, cap)
      truncated = true
    }
    let text = `[文件] ${f.path}`
    if (f.mode === 'lines' && f.lines) {
      text += `（第 ${f.lines.start}–${f.lines.end} 行）`
    }
    text += `\n\`\`\`${ext}\n${content}\n\`\`\``
    if (truncated) text += '\n（文件内容过长，已截断）'
    blocks.push({ type: 'text', text })
  }
  return blocks
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolvePromise(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(new Error(`请求体不是有效 JSON：${err.message}`))
      }
    })
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// plugin
// ---------------------------------------------------------------------------

export function apply(ctx) {

  const terminals = new TerminalManager()
  terminals.start()

  /** sessionId -> { cwd, files } */
  const mentionsBySession = new Map()
  /** user message ids already enriched — never enrich twice. */
  const enrichedIds = new Set()

  const disposers = []

  // Background-job access (optional): used by the 任务 view to list/kill the
  // current session's jobs. The caller is the session's own agent so the jobs
  // registry's ownership fence passes.
  const jobsSvc = ctx.get('jobs')
  const agentsSvc = ctx.get('agents')

  // ---- mention enrichment: attach mentioned files to the next user message ----
  const offPreStep = ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (!decision || decision.kind !== 'enter') return decision
    const sessionId = payload.agent.session.id
    const mention = mentionsBySession.get(sessionId)
    if (!mention || !mention.files || mention.files.length === 0) return decision
    const cwd = mention.cwd || payload.agent.session.header?.cwd
    if (!cwd) return decision
    // Find the first un-enriched real user message entering this step
    // (the trailing runtime-context message has source.kind 'plugin' and is
    // never touched).
    const target = decision.messages.find((m) =>
      m && m.role === 'user' && (!m.source || m.source.kind === 'user') && !enrichedIds.has(m.id)
    )
    if (!target) return decision
    const blocks = await buildMentionBlocks(mention, cwd)
    enrichedIds.add(target.id)
    // Bound the guard set so a very long-lived process does not grow it forever.
    if (enrichedIds.size > 10_000) enrichedIds.clear()
    mentionsBySession.delete(sessionId)
    const messages = decision.messages.map((m) =>
      m === target ? { ...m, content: [...m.content, ...blocks] } : m,
    )
    return { kind: 'enter', messages }
  })
  disposers.push(offPreStep)

  // ---- HTTP routes -----------------------------------------------------------
  // The web app provides webServer on a scoped layer the plugin's own ctx does
  // not see via ctx.get (same situation modlens documents). Ride the scoped
  // `ctx.inject` form: the closure runs when the service appears and never
  // runs where it does not (headless stays untouched).
  if (typeof ctx.inject === 'function') {
    const offInject = ctx.inject(['webServer'], (scope) => {
      const offRoute = scope.webServer.register({
        kind: 'prefix',
        path: '/dsh-ui-tools',
        handler: async (req, res) => {
          await handleRequest({ req, res, terminals, mentionsBySession, jobsSvc, agentsSvc })
        },
      })
      disposers.push(offRoute)
    })
    disposers.push(offInject)
  }

  return () => {
    for (const d of disposers) { try { d() } catch { /* ignore */ } }
    terminals.stop()
    mentionsBySession.clear()
  }
}

async function handleRequest({ req, res, terminals, mentionsBySession, jobsSvc, agentsSvc }) {
  try {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname
    const method = req.method || 'GET'

    // ---- SSE: terminal stream ----
    if (method === 'GET' && path.startsWith('/dsh-ui-tools/api/terminal/') && path.endsWith('/stream')) {
      const id = decodeURIComponent(path.slice('/dsh-ui-tools/api/terminal/'.length, -'/stream'.length))
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()
      const ok = terminals.attach(id, res)
      if (!ok) {
        res.end(`data: ${JSON.stringify({ type: 'exit', exitCode: null })}\n\n`)
        return
      }
      req.on('close', () => terminals.detach(id, res))
      return
    }

    // ---- terminal ops ----
    const termMatch = path.match(/^\/dsh-ui-tools\/api\/terminal\/([^/]+)\/(input|resize|signal|heartbeat)$/)
    if (termMatch) {
      const id = decodeURIComponent(termMatch[1])
      const op = termMatch[2]
      const body = await readBody(req)
      if (op === 'input') {
        terminals.input(id, String(body.data ?? ''))
        sendJson(res, 200, { ok: true })
      } else if (op === 'resize') {
        terminals.resize(id, Number(body.cols) || 80, Number(body.rows) || 24)
        sendJson(res, 200, { ok: true })
      } else if (op === 'signal') {
        const ok = terminals.signal(id, String(body.signal || 'SIGINT'))
        sendJson(res, 200, { ok })
      } else if (op === 'heartbeat') {
        const entry = terminals.terms.get(id)
        if (entry) entry.lastSeen = Date.now()
        sendJson(res, 200, { ok: true })
      }
      return
    }

    // ---- route table ----
    const routes = {
      'GET /dsh-ui-tools/api/files': async () => {
        const cwd = String(url.searchParams.get('cwd') || '')
        const rel = String(url.searchParams.get('path') || '')
        const root = resolve(cwd || homedir())
        const wp = workspacePath(root, rel)
        if (!wp) return sendJson(res, 400, { error: '路径超出工作区' })
        const { entries, truncated, error } = await readDirForUI(wp.abs)
        if (error && !isWindows) return sendJson(res, 500, { error })
        const parent = wp.rel === '' ? null : (wp.rel.includes('/') ? wp.rel.slice(0, wp.rel.lastIndexOf('/')) : '')
        const withStats = await Promise.all(entries.map(async (e) => {
          const st = await statSyncSafe(join(wp.abs, e.name))
          return {
            name: e.name,
            path: wp.rel === '' ? e.name : `${wp.rel}/${e.name}`,
            type: e.type,
            size: st && st.isFile() ? st.size : 0,
            mtime: st ? st.mtimeMs : 0,
          }
        }))
        sendJson(res, 200, { path: wp.rel, parent, entries: withStats, truncated })
      },

      'GET /dsh-ui-tools/api/file': async () => {
        const cwd = String(url.searchParams.get('cwd') || '')
        const rel = String(url.searchParams.get('path') || '')
        const root = resolve(cwd || homedir())
        const wp = workspacePath(root, rel)
        if (!wp) return sendJson(res, 400, { error: '路径超出工作区' })
        const st = await statSyncSafe(wp.abs)
        if (!st || !st.isFile()) return sendJson(res, 404, { error: '不是文件' })
        const name = wp.rel.split('/').pop() || wp.rel
        const kind = previewKind(name)
        if (kind === 'image' || kind === 'video') {
          sendJson(res, 200, { path: wp.rel, name, text: '', truncated: false, binary: true, kind, lines: 0, size: st.size })
          return
        }
        const { open } = await import('node:fs/promises')
        const handle = await open(wp.abs, 'r')
        try {
          const buf = Buffer.alloc(Math.min(st.size, MAX_PREVIEW_BYTES))
          const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
          const data = buf.subarray(0, bytesRead)
          if (looksLikeText(data)) {
            sendJson(res, 200, {
              path: wp.rel, name,
              text: decodeText(data),
              truncated: bytesRead < st.size,
              binary: false, kind: 'text',
              lines: countLines(data), size: st.size,
            })
          } else {
            sendJson(res, 200, {
              path: wp.rel, name,
              text: hexDump(data),
              truncated: bytesRead < st.size,
              binary: true, kind: kind === 'text' ? 'text' : 'none',
              lines: 0, size: st.size,
            })
          }
        } finally {
          await handle.close()
        }
      },

      'GET /dsh-ui-tools/api/raw': async () => {
        const cwd = String(url.searchParams.get('cwd') || '')
        const rel = String(url.searchParams.get('path') || '')
        const root = resolve(cwd || homedir())
        const wp = workspacePath(root, rel)
        if (!wp) return sendJson(res, 400, { error: '路径超出工作区' })
        if (!existsSync(wp.abs)) return sendJson(res, 404, { error: '文件不存在' })
        const ext = extname(wp.rel).replace(/^\./, '').toLowerCase()
        const mime = IMAGE_MIME[ext] || VIDEO_MIME[ext] || 'application/octet-stream'
        const data = await readFile(wp.abs)
        res.statusCode = 200
        res.setHeader('Content-Type', mime)
        res.setHeader('Cache-Control', 'no-store')
        res.end(data)
      },

      'POST /dsh-ui-tools/api/file': async () => {
        const body = await readBody(req)
        const cwd = String(body.cwd || '')
        const root = resolve(cwd || homedir())
        const wp = workspacePath(root, String(body.path || ''))
        if (!wp) return sendJson(res, 400, { error: '路径超出工作区' })
        const st = await statSyncSafe(wp.abs)
        if (!st || !st.isFile()) return sendJson(res, 404, { error: '不是文件' })
        const text = String(body.text ?? '')
        if (Buffer.byteLength(text, 'utf8') > MAX_SAVE_BYTES) {
          return sendJson(res, 400, { error: '文件内容过大（上限 2MB）' })
        }
        await writeFile(wp.abs, text, 'utf8')
        sendJson(res, 200, { ok: true })
      },

      'GET /dsh-ui-tools/api/commands': async () => {
        const cwd = String(url.searchParams.get('cwd') || '')
        const root = resolve(cwd || homedir())
        const { commands, path, warning } = await loadCommands(root)
        sendJson(res, 200, { commands, path, warning })
      },

      'POST /dsh-ui-tools/api/commands': async () => {
        const body = await readBody(req)
        const cwd = String(body.cwd || '')
        const root = resolve(cwd || homedir())
        const list = Array.isArray(body.commands) ? body.commands : []
        const clean = list
          .filter((c) => c && typeof c.name === 'string' && typeof c.command === 'string')
          .map((c) => ({ name: c.name, command: c.command, cwd: c.cwd }))
        try {
          const { path } = await saveCommands(root, clean)
          sendJson(res, 200, { ok: true, path })
        } catch (err) {
          sendJson(res, 500, { error: `保存命令文件失败：${err.message}` })
        }
      },

      'GET /dsh-ui-tools/api/mentions': async () => {
        const sessionId = String(url.searchParams.get('sessionId') || '')
        const m = mentionsBySession.get(sessionId)
        sendJson(res, 200, { files: m ? m.files : [], cwd: m ? m.cwd : '' })
      },

      'POST /dsh-ui-tools/api/mentions': async () => {
        const body = await readBody(req)
        const sessionId = String(body.sessionId || '')
        if (!sessionId) return sendJson(res, 400, { error: '缺少 sessionId' })
        const files = Array.isArray(body.files) ? body.files.slice(0, MAX_MENTION_FILES) : []
        mentionsBySession.set(sessionId, { cwd: String(body.cwd || ''), files })
        sendJson(res, 200, { ok: true })
      },

      'POST /dsh-ui-tools/api/terminal': async () => {
        const body = await readBody(req)
        const id = String(body.id || '')
        if (!id) return sendJson(res, 400, { error: '缺少终端 id' })
        const ok = terminals.create({
          id,
          cwd: String(body.cwd || ''),
          cols: Number(body.cols) || 80,
          rows: Number(body.rows) || 24,
          command: body.command,
          title: body.title,
        })
        sendJson(res, ok ? 200 : 500, { ok })
      },

      'DELETE /dsh-ui-tools/api/terminal': async () => {
        const body = await readBody(req)
        terminals.kill(String(body.id || ''))
        sendJson(res, 200, { ok: true })
      },

      'GET /dsh-ui-tools/api/terminals': async () => {
        sendJson(res, 200, { terminals: terminals.list() })
      },

      'POST /dsh-ui-tools/api/git/query': async () => {
        const body = await readBody(req)
        const cwd = String(body.cwd || '')
        const commands = Array.isArray(body.commands) ? body.commands : []
        const outputs = []
        for (const argv of commands) {
          if (!Array.isArray(argv) || argv.length === 0) {
            outputs.push('')
            continue
          }
          // argv[0] is the binary name ('git'); execFile takes it separately.
          const r = await runGit(cwd, argv.slice(1).map(String))
          outputs.push(r.ok ? r.output : `[git error] ${r.error}`)
        }
        sendJson(res, 200, { outputs })
      },

      'POST /dsh-ui-tools/api/jobs/kill': async () => {
        const body = await readBody(req)
        const sessionId = String(body.sessionId || '')
        const jobId = String(body.jobId || '')
        const agent = agentsSvc?.get(sessionId)
        if (!jobsSvc || !agent) return sendJson(res, 200, { ok: false, error: 'jobs 服务或会话不可用' })
        try {
          const result = jobsSvc.kill(jobId, agent, 'user')
          sendJson(res, 200, { ok: true, result })
        } catch (err) {
          sendJson(res, 200, { ok: false, error: err.message })
        }
      },

      'POST /dsh-ui-tools/api/jobs/kill-all': async () => {
        const body = await readBody(req)
        const sessionId = String(body.sessionId || '')
        const agent = agentsSvc?.get(sessionId)
        if (!jobsSvc || !agent) return sendJson(res, 200, { ok: false, error: 'jobs 服务或会话不可用' })
        const killed = []
        for (const job of jobsSvc.list(agent)) {
          if (job.status === 'running' || job.status === 'stopping') {
            try {
              jobsSvc.kill(job.id, agent, 'user')
              killed.push(job.id)
            } catch { /* already gone */ }
          }
        }
        sendJson(res, 200, { ok: true, killed })
      },
    }

    const key = `${method} ${path}`
    const handler = routes[key]
    if (handler) return handler()
    sendJson(res, 404, { error: `未知路由：${key}` })
  } catch (err) {
    try {
      sendJson(res, 500, { error: `内部错误：${err.message}` })
    } catch { /* response already gone */ }
  }
}
