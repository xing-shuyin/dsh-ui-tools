/**
 * dsh-ui-tools — 后台服务检测管理器（移植自 pi-web-ui 的后台任务）。
 *
 * 检测并管理 AI 通过 bash/pwsh 在后台启动的监听端口服务（如 `npm run dev &`、
 * `python -m http.server`）：
 *
 *   1. hook `tools/execute` 的 bash/pwsh 工具：执行前快照 LISTENING 端口，
 *      执行完成 1.5s 后再快照，diff 出新监听的端口 → 认为是 AI 启动的后台
 *      服务，记录 { port, pid, since, name }（进程名尽力而为异步补全）。
 *   2. 服务列表是插件级全局状态（跨会话存活，与 pi-web-ui 一致），只会在
 *      进程退出或显式停止时移除。
 *   3. 每 30s 重新快照端口：端口 + pid 都匹配才保留，进程自己退出的条目
 *      自动从面板消失（静默更新）。
 *   4. 停止：killPidTree 杀掉整个进程树（Windows taskkill /F /T）。
 *
 * 与模型 todo（内联标记）完全独立：本模块只关心「真实运行的服务」。
 */

import { execFile, spawn } from 'node:child_process'

/** 需要监控的工具名（exec.name；bash/pwsh 均注册了 name 与 tool:name 两个别名）。 */
const SHELL_TOOL_NAMES = new Set(['bash', 'pwsh', 'tool:bash', 'tool:pwsh'])

/** 快照一次当前 LISTENING TCP 端口 → 属主 pid。Windows: netstat；POSIX: lsof。 */
async function snapshotListeningPorts() {
  const m = new Map()
  try {
    if (process.platform === 'win32') {
      const out = await new Promise((resolve, reject) => {
        execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true, timeout: 8000 }, (err, stdout) =>
          err ? reject(err) : resolve(stdout))
      })
      for (const line of String(out).split(/\r?\n/)) {
        const p = line.trim().split(/\s+/)
        // TCP 0.0.0.0:5173 0.0.0.0:0 LISTENING 12345
        if (p.length >= 5 && p[0] === 'TCP' && p[3] === 'LISTENING') {
          const port = Number(p[1].split(':').pop())
          const pid = Number(p[4])
          if (Number.isFinite(port) && Number.isFinite(pid)) m.set(port, pid)
        }
      }
    } else {
      const out = await new Promise((resolve, reject) => {
        execFile('lsof', ['-iTCP', '-sTCP:LISTEN', '-P', '-n'], { timeout: 8000 }, (err, stdout) =>
          err ? reject(err) : resolve(stdout))
      })
      for (const line of String(out).split(/\r?\n/).slice(1)) {
        const p = line.trim().split(/\s+/)
        if (p.length >= 9) {
          // NAME 列尾部："*:5173 (LISTEN)" 或 "[::1]:5173 (LISTEN)"
          const mm = (p[p.length - 1] ?? '').match(/(\d+)\)?\s*$/)
          const port = mm ? Number(mm[1]) : NaN
          const pid = Number(p[1])
          if (Number.isFinite(port) && Number.isFinite(pid)) m.set(port, pid)
        }
      }
    }
  } catch {
    // best effort —— 快照失败本轮不跟踪
  }
  return m
}

/** 尽力获取进程名（Windows: tasklist；POSIX: ps）。进程已消失返回 undefined。 */
async function lookupProcessName(pid) {
  try {
    if (process.platform === 'win32') {
      const out = await new Promise((resolve, reject) => {
        execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000 }, (err, stdout) =>
          err ? reject(err) : resolve(stdout))
      })
      // CSV: "node.exe","12345",...
      const m = String(out).match(/"([^"]+)"/)
      return m ? m[1] : undefined
    }
    const out = await new Promise((resolve, reject) => {
      execFile('ps', ['-o', 'comm=', '-p', String(pid)], { timeout: 4000 }, (err, stdout) =>
        err ? reject(err) : resolve(stdout))
    })
    const name = String(out).trim()
    return name || undefined
  } catch {
    return undefined
  }
}

/** 杀掉 pid 及其整个进程树（跨平台）。 */
function killPidTree(pid) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      }).unref()
    } else {
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    // already dead
  }
}

/**
 * 创建后台服务管理器。返回 { list, kill, killAll, dispose }。
 * 挂载时机：插件 apply 时（tools/execute hook 需要先于工具执行注册，prepend）。
 */
export function createBackgroundServerManager(ctx) {
  /** port → { pid, since, name? } */
  const servers = new Map()
  /** 是否已 hook tools/execute（防止重复挂载）。 */
  let hooked = false
  let pruneTimer = null

  /** 当前列表（按启动时间排序）。 */
  const list = () =>
    [...servers.entries()]
      .map(([port, v]) => ({
        port,
        pid: v.pid,
        since: v.since,
        ...(v.name ? { name: v.name } : {}),
      }))
      .sort((a, b) => a.since - b.since)

  /** bash/pwsh 执行完成后延迟 diff：发现 AI 启动的新监听服务。 */
  const trackServers = async (before) => {
    await new Promise((r) => setTimeout(r, 1500))
    const after = await snapshotListeningPorts()
    let added = false
    for (const [port, pid] of after) {
      if (!before.has(port) && !servers.has(port)) {
        servers.set(port, { pid, since: Date.now() })
        added = true
        void lookupProcessName(pid).then((name) => {
          const cur = servers.get(port)
          if (cur && cur.pid === pid && name) cur.name = name
        })
        console.log(`[dsh-ui-tools] 检测到 AI 启动的后台服务：端口 ${port}（pid ${pid}）——可在「任务」面板单独停止或全部关闭`)
      }
    }
    return added
  }

  /** 周期清理：端口 + pid 双匹配，进程退出即移除。 */
  const prune = async () => {
    if (servers.size === 0) return
    const now = await snapshotListeningPorts()
    let changed = false
    for (const [port, v] of [...servers]) {
      if (now.get(port) !== v.pid) {
        servers.delete(port)
        changed = true
      }
    }
    if (changed) console.log(`[dsh-ui-tools] 后台服务已退出，面板清理：剩余 ${servers.size} 个`)
  }

  /** hook bash/pwsh 工具：执行前后端口 diff（waterfall 环绕，await next() 等工具完成）。 */
  const hookShell = () => {
    if (hooked) return
    hooked = true
    ctx.on('tools/execute', async (exec, next) => {
      if (!exec || !SHELL_TOOL_NAMES.has(exec.name)) return next()
      const before = await snapshotListeningPorts()
      const result = await next() // 等待工具执行完成（bash 正常返回但服务残留监听）
      void trackServers(before)
      return result
    }, true)
  }

  hookShell()

  // 每 30s 清理死进程（unref：不阻止进程退出）
  pruneTimer = setInterval(() => void prune(), 30_000)
  pruneTimer.unref?.()

  return {
    list,
    /** 停止一个后台服务（按端口）。返回是否停止。 */
    async kill(port) {
      const entry = servers.get(port)
      if (!entry) return false
      killPidTree(entry.pid)
      servers.delete(port)
      console.log(`[dsh-ui-tools] 已停止后台服务：端口 ${port}（pid ${entry.pid}）`)
      return true
    },
    /** 停止全部。返回被停止的端口列表。 */
    async killAll() {
      const ports = [...servers.keys()]
      for (const port of ports) {
        const entry = servers.get(port)
        if (entry) {
          killPidTree(entry.pid)
          servers.delete(port)
        }
      }
      if (ports.length) console.log(`[dsh-ui-tools] 已停止全部后台服务：${ports.join(', ')}`)
      return ports
    },
    dispose() {
      if (pruneTimer) clearInterval(pruneTimer)
      pruneTimer = null
      servers.clear()
    },
  }
}
