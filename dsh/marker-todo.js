/**
 * dsh-ui-tools — inline-marker todo（移植自 pi-marker-tools）。
 *
 * 把模型侧的 `todo_write` 工具替换为「写在回答正文里的 [[todo:...]] 行内标记」：
 *
 *   - systemPrompt.section   注入标记语法指引（order 150），并声明 todo_write 已停用
 *   - tools/pre-execute      拒绝 todo_write 调用，返回指引性错误
 *   - markers_list           只读查询工具（读操作仍走真工具）
 *   - session/event          监听 assistant/message，解析并执行 [[todo:...]] 标记
 *                            → 把富状态快照内嵌进原生 `todo/write` 事件持久化
 *                              （旧日志仍兼容读取自定义 `marker/todos` 快照）
 *
 * 与 pi-marker-tools 一致：标记文本保留在消息原文里（不剥除，避免破坏 provider
 * 缓存）；执行失败的标记也保留，供模型下轮修正重写。
 *
 * 持久化格式说明：`marker/todos` 是本插件自定义的会话事件类型，而当前 harness
 * 构建的 `Session.append` 无法为其信封写入 `ignorable` 标记，持久化加载门禁
 * （KNOWN_SESSION_EVENT_TYPES ∪ ignorable）会拒绝整个日志的重载。因此富状态
 * 快照改为内嵌进原生已知类型 `todo/write` 的 data（`{ todos, marker }`）——
 * 所有既有消费者只读取 `.todos`，invariant/客户端 schema 均放行额外字段；
 * 插件侧用 `loadState` 读取 `.marker` 恢复富状态（id、依赖、tombstone、nextId）。
 */

const STORE_TYPE = 'marker/todos'

/** 富状态在 todo/write 事件 data 里的内嵌键（见文件头格式说明）。 */
const RICH_KEY = 'marker'

/** [[tool:op:pos1,pos2,k=v]] 通用标记正则（与 pi-marker-tools 相同）。 */
const TOKEN_RE = /\[\[\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*([A-Za-z][A-Za-z0-9_-]*)\s*:(.*?)\s*\]\]/g

function splitArgs(body) {
  const args = []
  const kwargs = {}
  for (const piece of body.split(',')) {
    const trimmed = piece.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    // 形如 blocks=3 → kwargs；其余为位置参数
    if (eq > 0 && /^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed.slice(0, eq))) {
      kwargs[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
    } else {
      args.push(trimmed)
    }
  }
  return { args, kwargs }
}

function parseMarkers(text) {
  const tokens = []
  TOKEN_RE.lastIndex = 0
  let m
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const tool = m[1]
    const op = m[2]
    const body = m[3]
    if (body.includes('[[')) continue // 防御嵌套
    const { args, kwargs } = splitArgs(body)
    tokens.push({ tool, op, args, kwargs, raw: m[0] })
  }
  return tokens
}

// ---------------------------------------------------------------------------
// todo 状态
// ---------------------------------------------------------------------------

function initState() {
  return { tasks: [], nextId: 1 }
}

/** 从会话日志重建最新快照：优先 `todo/write` 内嵌的 `.marker`，兼容旧 `marker/todos`（均 last-write-wins）。 */
function loadState(session) {
  let latest
  for (const ev of session.events) {
    if (ev.type === STORE_TYPE && ev.data && Array.isArray(ev.data.tasks)) latest = ev.data
    if (ev.type === 'todo/write' && ev.data && ev.data[RICH_KEY] && Array.isArray(ev.data[RICH_KEY].tasks)) latest = ev.data[RICH_KEY]
  }
  if (!latest) return initState()
  return {
    tasks: latest.tasks.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      activeForm: t.activeForm,
      blockedBy: (t.blockedBy || []).slice(),
      createdAt: t.createdAt,
    })),
    nextId: latest.nextId,
  }
}

function findTask(state, id) {
  return state.tasks.find((t) => t.id === id && t.status !== 'deleted')
}

function parseId(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 执行一条 todo 标记，原地修改 state。 */
function applyOp(state, token) {
  const op = token.op

  if (op === 'new') {
    const subject = (token.args[0] || '').trim()
    if (!subject) return { applied: false, error: 'todo:new 需要一个主题参数 [[todo:new:<主题>]]' }
    const id = state.nextId++
    state.tasks.push({ id, subject, status: 'pending', blockedBy: [], createdAt: Date.now() })
    return { applied: true, feedback: `Created #${id}: ${subject}` }
  }

  if (op === 'set') {
    const id = parseId(token.args[0])
    if (id === null) return { applied: false, error: `todo:set id 无效: ${token.args[0] ?? ''}` }
    const status = (token.args[1] || '').trim()
    if (!(status === 'pending' || status === 'in_progress' || status === 'completed')) {
      return { applied: false, error: `todo:set 状态无效: ${status}（pending|in_progress|completed）` }
    }
    const task = findTask(state, id)
    if (!task) return { applied: false, error: `todo:set 任务 #${id} 不存在` }
    if (task.status === 'completed' && status !== 'completed') {
      return { applied: false, error: `任务 #${id} 已完成，不能回退` }
    }
    task.status = status
    if (status === 'in_progress' && token.kwargs.activeForm) task.activeForm = token.kwargs.activeForm
    return { applied: true, feedback: `Updated #${id} → ${status}` }
  }

  if (op === 'remove') {
    const id = parseId(token.args[0])
    if (id === null) return { applied: false, error: `todo:remove id 无效: ${token.args[0] ?? ''}` }
    const task = findTask(state, id)
    if (!task) return { applied: false, error: `todo:remove 任务 #${id} 不存在` }
    task.status = 'deleted'
    return { applied: true, feedback: `Deleted #${id}` }
  }

  if (op === 'dep') {
    const id = parseId(token.args[0])
    if (id === null) return { applied: false, error: `todo:dep id 无效: ${token.args[0] ?? ''}` }
    const task = findTask(state, id)
    if (!task) return { applied: false, error: `todo:dep 任务 #${id} 不存在` }
    const raw = token.kwargs.blocks ?? token.args[1] ?? ''
    const deps = raw.split(',').map((x) => parseId(x.trim())).filter((x) => x !== null)
    const bad = deps.filter((d) => d === id || !findTask(state, d))
    if (bad.length) return { applied: false, error: `todo:dep 非法依赖 ${bad.join(',')}（不存在或自环）` }
    task.blockedBy = deps
    return { applied: true, feedback: `#${id} blockedBy: ${deps.join(',') || '(none)'}` }
  }

  if (op === 'title') {
    const id = parseId(token.args[0])
    if (id === null) return { applied: false, error: `todo:title id 无效: ${token.args[0] ?? ''}` }
    const task = findTask(state, id)
    if (!task) return { applied: false, error: `todo:title 任务 #${id} 不存在` }
    const subject = (token.args[1] || '').trim()
    if (!subject) return { applied: false, error: 'todo:title 需要新标题' }
    task.subject = subject
    return { applied: true, feedback: `Renamed #${id} → ${subject}` }
  }

  return { applied: false, error: `todo 未知操作: ${op}` }
}

// ---------------------------------------------------------------------------
// 会话事件接入
// ---------------------------------------------------------------------------

function extractText(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/** 富状态快照内嵌进 todo/write 持久化，并驱动 TodoDock（只读 `.todos`）。 */
function persist(session, state) {
  const todos = state.tasks
    .filter((t) => t.status !== 'deleted')
    .map((t) => ({ content: t.subject, status: t.status }))
  session.append('todo/write', { todos, [RICH_KEY]: { tasks: state.tasks, nextId: state.nextId } })
}

const GUIDANCE = [
  '# 内联标记工具（todo 已替换为行内标记）',
  '- 不要再调用 `todo_write` 工具（已停用，调用会被拒绝）。任务状态变化请直接写在回答正文里，采用内联标记语法，插件会自动执行并写入任务面板，不会中断你的回答：',
  '  - [[todo:new:写单元测试]]    新建 pending 任务，分配新 id',
  '  - [[todo:set:2,completed]]   把 #2 置为 completed（也可 in_progress / pending）',
  '  - [[todo:set:2,in_progress]] 标记 #2 进行中',
  '  - [[todo:remove:2]]          删除 #2',
  '  - [[todo:dep:2,blocks=1,3]]  声明 #2 依赖 #1、#3',
  '  - [[todo:title:2:新标题]]    重命名 #2',
  '- id 由 [[todo:new:...]] 分配（从 1 递增）；不要编造不存在的 id。',
  '- 需要查看当前任务列表（含 id）时，用只读工具 `markers_list`。',
].join('\n')

const DENY_REASON = 'todo_write 已由内联标记取代：请在回答正文直接写 [[todo:new:...]] / [[todo:set:<id>,completed]] 等标记，插件会自动执行并写入任务面板；查询当前列表请用 markers_list 工具。'

/**
 * 在 bundle ctx 上安装行内标记 todo 功能。返回 disposer。
 */
export function setupMarkerTodo(ctx) {
  const disposers = []

  // 1) 注入系统提示指引
  const sys = ctx.get('systemPrompt')
  if (sys !== undefined) {
    disposers.push(sys.section({
      name: 'marker-tools:inline-todo',
      order: 150,
      text: GUIDANCE,
    }))
  }

  // 2) 拒绝 todo_write 调用（替换）
  disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec && exec.name === 'todo_write') {
      return { kind: 'deny', reason: DENY_REASON }
    }
    return next()
  }))

  // 3) 只读查询工具 markers_list
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    disposers.push(tools.register({
      name: 'markers_list',
      description: '只读查询内联标记（todo）当前状态。状态【写】操作请一律用 [[todo:...]] 内联标记写在回答正文里，不要调用本工具做写操作。',
      parameters: {
        type: 'object',
        properties: {
          includeDeleted: {
            type: 'boolean',
            description: '是否包含已删除任务（tombstone）',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', required: true },
            todos: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'integer', required: true },
                  subject: { type: 'string', required: true },
                  status: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render(args, value) {
          return [{ type: 'text', text: value.text }]
        },
      },
      execute(args, exec) {
        const session = exec && exec.agent ? exec.agent.session : undefined
        if (!session) return { text: 'No todos', todos: [] }
        const state = loadState(session)
        const visible = state.tasks.filter((t) => (args && args.includeDeleted) || t.status !== 'deleted')
        if (visible.length === 0) return { text: 'No todos', todos: [] }
        return {
          text: visible.map((t) => `[${t.status}] #${t.id}: ${t.subject}`).join('\n'),
          todos: visible.map((t) => ({ id: t.id, subject: t.subject, status: t.status })),
        }
      },
    }))
  }

  // 4) 解析 assistant 消息中的标记并执行
  disposers.push(ctx.on('session/event', (session, event) => {
    if (!event || event.type !== 'assistant/message') return
    const message = event.data && event.data.message
    const text = extractText(message)
    if (!text || !text.includes('[[')) return
    const tokens = parseMarkers(text).filter((t) => t.tool === 'todo')
    if (tokens.length === 0) return
    // 延迟到当前 append 发布边界关闭之后（session.append 不允许在 session/event
    // 观察者内重入）。
    queueMicrotask(() => {
      try {
        const state = loadState(session)
        let changed = false
        for (const token of tokens) {
          const r = applyOp(state, token)
          if (r.applied) changed = true
        }
        if (changed) persist(session, state)
      } catch (error) {
        console.error('[dsh-ui-tools] marker-todo apply failed:', String((error && error.message) || error))
      }
    })
  }))

  return () => {
    for (const d of disposers) {
      try { d() } catch { /* ignore */ }
    }
  }
}
