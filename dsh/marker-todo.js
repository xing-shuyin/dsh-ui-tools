/**
 * dsh-ui-tools — 通用内联标记系统 + todo 功能（完全替换原生 todo_write）。
 *
 * 设计目标：todo 管理完全在 AI 回答内部完成，不触发额外的工具调用问答往返。
 * 模型在回答正文里写 [[todo:...]] 内联标记，插件在 assistant 消息落库后自动
 * 解析执行——不需要调用工具、等待返回，因此少几轮问答输入过程。
 *
 * 架构（参照原生 @deepseek-ai/dsh-tool-todo 的 schema/持久化）：
 *
 *   1. 通用内联标记框架：解析回答正文里的 [[tool:op:args]] 标记，按注册表
 *      `INLINE_TOOLS` 分发。todo 是第一个注册的功能。
 *
 *   2. 第三方扩展：注册表以 Cordis Service `inlineMarkers` 发布（ctx.provide），
 *      任何 bundle 插件用官方格式注册新的内联标记工具：
 *
 *          // 第三方插件 dsh/index.js（官方 bundle 格式）
 *          export const name = 'my-inline-tool'
 *          export const inject = ['inlineMarkers']
 *          export function apply(ctx) {
 *            ctx.inlineMarkers.register('note', {
 *              applyOp(state, token) {
 *                // state 为当前会话共享富状态；token 为 { tool, op, args, kwargs, raw }
 *                return { applied: true, feedback: '...' }
 *              },
 *            })
 *          }
 *
 *      注册后模型写 [[note:...]] 即自动触发，与内置 todo 完全一致。
 *
 *   3. 原生 `todo_write` 工具从模型可见工具中移除（`tools.restrict` deny）：
 *      模型看不到它、不会调用它，因此不会报错；todo 全部走行内标记。
 *      - `tools/execute` 环绕兜底：万一旧会话/旧 prompt 仍发出调用，由本项目
 *        富状态执行并返回与原生 output schema 一致的结果，绝不报错。
 *
 *   4. 持久化沿用原生 `todo/write` 事件：`data.todos` 供原生 todos 投影与
 *      客户端 TodoRow 渲染；`data.marker` 内嵌本插件的富状态（id、依赖、
 *      tombstone、nextId），供 `markers_list` 与状态恢复。旧日志仍兼容读取
 *      自定义 `marker/todos` 快照。
 *
 *   5. `markers_list` 只读查询工具（读操作仍走真工具）；系统提示指引
 *      （order 150）说明任务操作一律用 [[todo:...]] 内联标记。
 *
 * 与 pi-marker-tools 一致：标记文本保留在消息原文里（不剥除，避免破坏
 * provider 缓存）；执行失败的标记也保留，供模型下轮修正重写。
 *
 * 序列化约束：`Session.append` 要求 data 无损 JSON 可序列化（undefined、
 * BigInt、函数、循环引用等都会拒绝），因此富状态快照在写入前必须清理
 * 未定义字段（如 activeForm 缺省时不得写入 undefined 属性）。
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
  // 文档/说明里的示例标记常被写进反引号（行内代码或 ``` 代码块），这些
  // 不应执行。生成等长掩码（代码段字符替换为空格，保持索引对齐），只在
  // 非代码段上匹配；raw 从原文按位置取回，保证反馈/剥除不受影响。
  const masked = text.replace(/(```[\s\S]*?```|`[^`\n]*`)/g, (m) => ' '.repeat(m.length))
  const tokens = []
  TOKEN_RE.lastIndex = 0
  let m
  while ((m = TOKEN_RE.exec(masked)) !== null) {
    const tool = m[1]
    const op = m[2]
    const body = m[3]
    if (body.includes('[[')) continue // 防御嵌套
    const { args, kwargs } = splitArgs(body)
    const raw = text.slice(m.index, m.index + m[0].length)
    tokens.push({ tool, op, args, kwargs, raw })
  }
  return tokens
}

// ---------------------------------------------------------------------------
// 通用内联标记注册表（todo 是第一个可扩展功能）
//
// 该注册表同时以 Cordis Service `inlineMarkers` 发布（见 setupMarkerTodo），
// 供第三方 bundle 插件用官方格式注册新的内联标记工具：
//
//   // 第三方插件 dsh/index.js
//   export const name = 'my-inline-tool'
//   export const inject = ['inlineMarkers']
//   export function apply(ctx) {
//     ctx.inlineMarkers.register('note', {
//       applyOp(state, token) {
//         // state 为当前会话的共享富状态（含 tasks/nextId），token 为解析出的标记
//         // { tool, op, args, kwargs, raw }
//         return { applied: true, feedback: '...' }
//       },
//     })
//   }
//
// 注册后，模型在回答正文写 [[note:...]] 即自动触发，与内置 todo 一致。
// ---------------------------------------------------------------------------

/** tool 名 → { applyOp(state, token) → { applied, feedback?, error? } } */
const INLINE_TOOLS = {}


/** tool 名 → { description, enabled }（设置面板展示 + 插件级开关）。 */
const TOOL_META = new Map()

/**
 * 内联标记服务：第三方 bundle 通过 ctx.inject(['inlineMarkers']) 获取。
 *
 * 每个注册的 tool 自带插件级开关（enabled，默认 true）：设置面板可单独
 * 停用某个插件（如 todo），停用后该插件的标记不再解析执行，其他插件不受
 * 影响。全局总开关由宿主（index.js 的 markerController）控制整个框架的
 * 挂载/卸载，与这里的 per-tool 开关正交。
 */
function createInlineMarkersService() {
  return {
    /** 注册一个内联标记工具（def 可带 description 供设置面板展示）。返回 disposer。 */
    register(name, def) {
      if (typeof name !== 'string' || !name) throw new Error('inlineMarkers.register: name must be a non-empty string')
      if (!def || typeof def.applyOp !== 'function') throw new Error(`inlineMarkers.register(${name}): def must provide applyOp(state, token)`)
      if (INLINE_TOOLS[name]) throw new Error(`inlineMarkers.register(${name}): tool already registered`)
      INLINE_TOOLS[name] = def
      TOOL_META.set(name, {
        description: typeof def.description === 'string' ? def.description : '',
        enabled: true,
      })
      return () => {
        delete INLINE_TOOLS[name]
        TOOL_META.delete(name)
      }
    },
    /** 是否已注册某工具。 */
    has(name) {
      return Object.hasOwn(INLINE_TOOLS, name)
    },
    /** 已注册的工具名列表。 */
    list() {
      return Object.keys(INLINE_TOOLS)
    },
    /** 已注册工具元信息（含启用状态），供设置面板展示。 */
    meta(name) {
      return TOOL_META.get(name)
    },
    /** 插件级开关：停用后该插件的标记不再执行（注册仍保留）。 */
    setEnabled(name, enabled) {
      const m = TOOL_META.get(name)
      if (m) m.enabled = enabled !== false
      return m ? m.enabled : false
    },
    /** 是否启用某插件（未注册视为禁用）。 */
    isEnabled(name) {
      const m = TOOL_META.get(name)
      return m ? m.enabled : false
    },
  }
}

// ---------------------------------------------------------------------------
// todo 状态
// ---------------------------------------------------------------------------

function initState() {
  return { tasks: [], nextId: 1 }
}

/** 从任务对象重建无损 JSON 表示（绝不写入 undefined 字段）。 */
function cleanTask(t) {
  const clean = {
    id: t.id,
    subject: t.subject,
    status: t.status,
    blockedBy: (t.blockedBy || []).slice(),
    createdAt: t.createdAt,
  }
  if (t.activeForm !== undefined) clean.activeForm = t.activeForm
  return clean
}

/**
 * 从会话日志重建最新快照：优先 `todo/write` 内嵌的 `.marker`，兼容旧
 * `marker/todos`（均 last-write-wins）。除 todo 核心字段外，保留第三方
 * 内联工具写入的扩展字段（JSON 安全值原样复制）。
 */
function loadState(session) {
  let latest
  for (const ev of session.events) {
    if (ev.type === STORE_TYPE && ev.data && Array.isArray(ev.data.tasks)) latest = ev.data
    if (ev.type === 'todo/write' && ev.data && ev.data[RICH_KEY] && Array.isArray(ev.data[RICH_KEY].tasks)) latest = ev.data[RICH_KEY]
  }
  if (!latest) return initState()
  const state = {
    tasks: latest.tasks.map(cleanTask),
    nextId: latest.nextId,
  }
  // 透传扩展字段（第三方 inline 工具数据），跳过 todo 核心键
  for (const key of Object.keys(latest)) {
    if (key === 'tasks' || key === 'nextId') continue
    if (latest[key] !== undefined) state[key] = latest[key]
  }
  return state
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
function applyTodoOp(state, token) {
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
    // 语法 [[todo:title:<id>:<新标题>]]。splitArgs 只按逗号切分，id 与新标题
    // 用冒号分隔时会合并进 args[0]（如 "2:新标题"），需按首个冒号拆开；
    // 若新标题含逗号，逗号后的片段在 args[1..]，用逗号拼回。
    let id = parseId(token.args[0])
    let subject = (token.args[1] || '').trim()
    if (id === null && typeof token.args[0] === 'string' && token.args[0].includes(':')) {
      const raw0 = token.args[0]
      const sep = raw0.indexOf(':')
      id = parseId(raw0.slice(0, sep).trim())
      subject = [raw0.slice(sep + 1), ...token.args.slice(1)].join(',').trim()
    }
    if (id === null) return { applied: false, error: `todo:title id 无效: ${token.args[0] ?? ''}` }
    const task = findTask(state, id)
    if (!task) return { applied: false, error: `todo:title 任务 #${id} 不存在` }
    if (!subject) return { applied: false, error: 'todo:title 需要新标题' }
    task.subject = subject
    return { applied: true, feedback: `Renamed #${id} → ${subject}` }
  }

  return { applied: false, error: `todo 未知操作: ${op}` }
}

// 注册 todo 为内联标记系统的第一个功能（第三方可继续注册其他工具）
// todo 插件注册已移入 setupTodoPlugin（受插件级开关控制），不再在模块级注册。

/**
 * 把原生 todo_write 的「整表替换」语义合并进富状态（tools/execute 兜底用）。
 *
 * 原生 todo_write 每次调用携带完整目标列表（[{ content, status }]），语义是
 * REPLACES the previous list。这里按 content 匹配既有任务：同主题更新状态并保留
 * id/依赖/activeForm/createdAt；新主题分配新 id；未出现在新列表的既有任务置为
 * deleted（tombstone，保留历史）。这样 todo_write 与 [[todo:...]] 标记共享同一
 * 富状态源，id 稳定、依赖不丢。
 */
function mergeWholeList(state, rawTodos) {
  const live = new Map()
  for (const t of state.tasks) {
    if (t.status !== 'deleted') live.set(t.subject, t)
  }
  const seen = new Set()
  const kept = []
  for (const item of rawTodos) {
    const content = String(item.content || '').trim()
    if (!content) throw new Error('invalid todo: `content` must be a non-empty string')
    if (seen.has(content)) throw new Error(`invalid todos: duplicate content ${JSON.stringify(content)}`)
    seen.add(content)
    const existing = live.get(content)
    if (existing) {
      existing.status = item.status
      kept.push(existing)
      live.delete(content)
    } else {
      const id = state.nextId++
      const task = { id, subject: content, status: item.status, blockedBy: [], createdAt: Date.now() }
      state.tasks.push(task)
      kept.push(task)
    }
  }
  // 未出现在新列表中的既有任务 → tombstone
  for (const t of live.values()) t.status = 'deleted'
  return kept
}

/** 统计可见任务的数量（与原生 todo_write 的 counts 结构一致）。 */
function countStatuses(tasks) {
  const counts = { pending: 0, inProgress: 0, completed: 0 }
  for (const t of tasks) {
    if (t.status === 'pending') counts.pending++
    else if (t.status === 'in_progress') counts.inProgress++
    else if (t.status === 'completed') counts.completed++
  }
  return counts
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

/**
 * 富状态快照内嵌进 todo/write 持久化，并驱动 TodoDock（只读 `.todos`）。
 * 除 todo 核心字段外，同时写入第三方 inline 工具的扩展字段（JSON 安全值）。
 */
function persist(session, state) {
  const todos = state.tasks
    .filter((t) => t.status !== 'deleted')
    .map((t) => ({ content: t.subject, status: t.status }))
  // 写入前清理未定义字段（Session.append 要求无损 JSON）
  const tasks = state.tasks.map(cleanTask)
  const snapshot = { tasks, nextId: state.nextId }
  for (const key of Object.keys(state)) {
    if (key === 'tasks' || key === 'nextId') continue
    if (state[key] !== undefined) snapshot[key] = state[key]
  }
  const data = { todos, [RICH_KEY]: snapshot }
  // 防御：Session.append 会对 data 做严格无损 JSON 校验（拒绝 undefined/BigInt/
  // 函数/符号/循环引用/稀疏数组/负零/非有限数/Map/Set/Date/类实例等 exotic 值）。
  // 任何第三方扩展字段或异常状态都可能携带此类值，这里统一清洗，绝不让 todo/write
  // 事件写入失败（历史 bug：web 环境第二次 todo_write 抛 non-JSON-serializable）。
  const clean = sanitizeJson(data)
  if (clean === null || clean === undefined) {
    console.error('[dsh-ui-tools] marker-todo persist produced no JSON-safe snapshot; skipping write')
    return
  }
  const before = safeJson(data)
  const after = safeJson(clean)
  if (before !== null && after !== null && before !== after) {
    console.error('[dsh-ui-tools] marker-todo persist sanitized non-JSON-safe data:', before.slice(0, 800))
  }
  session.append('todo/write', clean)
}

/** JSON.stringify 的安全包装（BigInt/循环引用会抛错时返回 null）。 */
function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

/**
 * 深度清洗为严格无损 JSON（与 dsh-session snapshotJsonValue 允许的边界一致）：
 * 丢弃 undefined/函数/符号、把 BigInt 转 Number、把非有限数/负零归零、跳过稀疏
 * 数组空洞与循环引用、把 Date/Map/Set 转为 JSON 等价物、把类实例转为其可枚举
 * 字段。返回 null 表示根值不可表示。
 */
function sanitizeJson(value, seen = null) {
  if (value === null) return null
  const t = typeof value
  if (t === 'string' || t === 'boolean') return value
  if (t === 'number') return (Number.isFinite(value) && !Object.is(value, -0)) ? value : 0
  if (t === 'bigint') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  if (t !== 'object') return undefined // undefined / function / symbol
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Map) return sanitizeJson(Object.fromEntries(value), seen)
  if (value instanceof Set) return sanitizeJson([...value], seen)
  const seenSet = seen || new WeakSet()
  if (seenSet.has(value)) return undefined // 循环引用
  seenSet.add(value)
  let out
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return undefined
    out = []
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) continue // 稀疏数组空洞
      const v = sanitizeJson(value[i], seenSet)
      if (v !== undefined) out.push(v)
    }
  } else {
    out = {}
    for (const k of Object.keys(value)) {
      const v = sanitizeJson(value[k], seenSet)
      if (v !== undefined) out[k] = v
    }
  }
  seenSet.delete(value)
  return out
}

const GUIDANCE = [
  '# todo（完全内联：原生 todo_write 已由本插件替换为行内标记）',
  '- 不要再调用 `todo_write` 工具（已从可用工具中移除，不在此 prompt 的工具列表里；调用它只会得到 unknown tool）。',
  '- 任务状态变化请直接写在回答正文里，采用内联标记语法，插件会在你的回答落库后自动执行并写入任务面板，不会中断你的回答、也不产生额外工具往返：',
  '  - `[[todo:new:写单元测试]]`    新建 pending 任务，分配新 id',
  '  - `[[todo:set:2,completed]]`   把 #2 置为 completed（也可 in_progress / pending）',
  '  - `[[todo:set:2,in_progress]]` 标记 #2 进行中',
  '  - `[[todo:remove:2]]`          删除 #2',
  '  - `[[todo:dep:2,blocks=1,3]]`  声明 #2 依赖 #1、#3',
  '  - `[[todo:title:2:新标题]]`    重命名 #2',
  '- 注意：上面示例都写在反引号里仅作语法说明，反引号内的标记不会被解析执行。真正要操作任务时，在正文里直接写具体主题/编号，不要加反引号。',
  '- 内联标记的 id 由 `[[todo:new:...]]` 分配（从 1 递增）；不要编造不存在的 id。',
  '- 需要查看当前任务列表（含 id）时，用只读工具 `markers_list`。',
].join('\n')

/**
 * tools/execute 环绕兜底：旧会话/旧 prompt 仍调用 todo_write 时由本项目接管。
 *
 * waterfall 语义：监听器不调用 next() 即否决整条链（含原生执行）。这里对
 * todo_write 直接执行本项目富状态逻辑并返回与原 schema 一致的
 * `{ isError: false, value: { todos, counts } }`；normalizeDispatchResult
 * 会用原工具 output schema 校验 value 并走原生 render，因此模型、UI、日志
 * 全部原生兼容。其余工具一律 next() 放行。
 */
function createTodoWriteReplacer() {
  return async (exec, next) => {
    if (!exec || exec.name !== 'todo_write') return next()
    const session = exec.agent && exec.agent.session
    if (!session) return next() // 无 agent（例如 SDK 子分发）→ 交给原生处理
    const raw = (exec.arguments && Array.isArray(exec.arguments.todos)) ? exec.arguments.todos : []
    try {
      const state = loadState(session)
      const kept = mergeWholeList(state, raw)
      persist(session, state)
      return {
        isError: false,
        value: {
          todos: kept.map((t) => ({ content: t.subject, status: t.status })),
          counts: countStatuses(kept),
        },
      }
    } catch (error) {
      return {
        isError: true,
        error: { message: String((error && error.message) || error) },
        content: [{ type: 'text', text: `Error: ${String((error && error.message) || error)}` }],
      }
    }
  }
}

/**
 * 把原生 todo_write 从某 agent 的可见工具中移除（完全替换，而非拦截报错）。
 * 返回 disposer；agent 销毁时其 scoped effect 也会自动清理。
 */
function restrictTodoWrite(agent) {
  if (!agent || !agent.ctx) return null
  try {
    const toolsSvc = typeof agent.ctx.get === 'function' ? agent.ctx.get('tools') : undefined
    if (!toolsSvc || typeof toolsSvc.restrict !== 'function') return null
    return toolsSvc.restrict({ deny: ['todo_write'] })
  } catch (error) {
    console.error('[dsh-ui-tools] restrict todo_write failed:', String((error && error.message) || error))
    return null
  }
}

/**
 * 在 bundle ctx 上安装内联标记 todo 功能。返回 disposer。
 *
 * 服务获取方式：dsh web bundle 的 ctx 无法通过 `ctx.get()` 看到 scoped 服务层
 * （tools、systemPrompt、agents 都在 scoped 层），必须用 `ctx.inject` 形式
 * （与 index.js 的 webServer 注入一致）：闭包在服务出现时运行，服务不存在时
 * （headless）不运行。事件（tools/execute、agent/created、session/event）通过
 * ctx.on 全局监听，不依赖服务解析。
 */
/**
        * 安装通用内联标记框架：发布 inlineMarkers 服务（第三方 bundle 插件注册入口）、
        * markers_list 只读查询工具、assistant 消息标记解析分发。返回 { inlineMarkers,
        * disposer }。
        *
        * settings.tools 里显式关闭的插件（如 { todo: false }）在框架挂载时即禁用，
        * 之后由宿主 controller 通过 inlineMarkers.setEnabled 动态切换。
        *
        * 服务获取方式：dsh web bundle 的 ctx 无法通过 `ctx.get()` 看到 scoped 服务层
        * （tools、systemPrompt、agents 都在 scoped 层），必须用 `ctx.inject` 形式
        * （与 index.js 的 webServer 注入一致）：闭包在服务出现时运行，服务不存在时
        * （headless）不运行。事件（tools/execute、agent/created、session/event）通过
        * ctx.on 全局监听，不依赖服务解析。
        */
       export function setupInlineMarkers(ctx, settings = {}) {
         const disposers = []
         const inlineMarkers = createInlineMarkersService()

         // 0) 发布 inlineMarkers 服务：第三方 bundle 插件用官方格式
         //    `inject: ['inlineMarkers']` 获取，注册新的内联标记工具。
         //    ctx.provide 注册在 bundle 层（与 web-app 的 webServer 同层），
         //    profile 组合内后续插件均可见。
         disposers.push(ctx.provide('inlineMarkers', inlineMarkers))

         // 应用持久化的插件级开关（显式关闭的插件初始即禁用）
         const toolsCfg = (settings && settings.tools) || {}
         for (const [name, enabled] of Object.entries(toolsCfg)) {
           if (enabled === false) inlineMarkers.setEnabled(name, false)
         }

         // 1) 只读查询工具 markers_list（scoped 服务，走 inject；bundle ctx 的
         //    ctx.get('tools') 返回 undefined，直接 register 会静默跳过。
         //    register 接受普通对象定义（dsh-tools 的 register 只校验 output 结构；
         //    动态插件强制 defineTool 只针对动态 runner，bundle 不受限））
         if (typeof ctx.inject === 'function') {
           disposers.push(ctx.inject(['tools'], (scope) => {
             disposers.push(scope.tools.register({
               name: 'markers_list',
               description: '只读查询内联标记插件当前状态（如 todo 任务列表）。状态【写】操作请用对应插件的内联标记写在回答正文里（如 [[todo:new:...]] / [[todo:set:...]]），不要调用本工具做写操作。',
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
                   required: ['text', 'todos'],
                   properties: {
                     text: { type: 'string' },
                     todos: {
                       type: 'array',
                       items: {
                         type: 'object',
                         additionalProperties: false,
                         required: ['id', 'subject', 'status'],
                         properties: {
                           id: { type: 'integer' },
                           subject: { type: 'string' },
                           status: { type: 'string' },
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
                 // todo 插件被停用时不再展示其状态
                 if (!inlineMarkers.isEnabled('todo')) return { text: 'todo 插件已停用（设置 → 内联标记插件）', todos: [] }
                 const state = loadState(session)
                 const visible = state.tasks.filter((t) => (args && args.includeDeleted) || t.status !== 'deleted')
                 if (visible.length === 0) return { text: 'No todos', todos: [] }
                 return {
                   text: visible.map((t) => `[${t.status}] #${t.id}: ${t.subject}`).join('\n'),
                   todos: visible.map((t) => ({ id: t.id, subject: t.subject, status: t.status })),
                 }
               },
             }))
           }))
         }

         // 2) 解析 assistant 消息中的标记并按注册表分发执行（全局框架入口；
         //    插件级开关在分发时逐个检查）
         disposers.push(ctx.on('session/event', (session, event) => {
           if (!event || event.type !== 'assistant/message') return
           const message = event.data && event.data.message
           const text = extractText(message)
           if (!text || !text.includes('[[')) return
           const tokens = parseMarkers(text)
           if (tokens.length === 0) return
           // 延迟到当前 append 发布边界关闭之后（session.append 不允许在 session/event
           // 观察者内重入）。
           queueMicrotask(() => {
             try {
               const state = loadState(session)
               let changed = false
               for (const token of tokens) {
                 const tool = INLINE_TOOLS[token.tool]
                 if (!tool || typeof tool.applyOp !== 'function') continue
                 if (!inlineMarkers.isEnabled(token.tool)) continue // 插件级开关
                 const r = tool.applyOp(state, token)
                 if (r && r.applied) changed = true
               }
               if (changed) persist(session, state)
             } catch (error) {
               console.error('[dsh-ui-tools] marker-todo apply failed:', String((error && error.message) || error))
             }
           })
         }))

         return {
           inlineMarkers,
           disposer() {
             for (const d of disposers) {
               try { d() } catch { /* ignore */ }
             }
           },
         }
       }

       /**
        * todo 插件：把 todo 注册进 inlineMarkers（设置面板可单独停用）+ 注入系统提示
        * 指引 + todo_write 兜底替换与可见性移除。依赖框架先挂载（inlineMarkers 服务
        * 在场）；todo 插件停用时调用返回的 disposer：todo 标记不再执行、原生 todo_write
        * 恢复（restrict 撤销 + replacer 卸载 + guidance 撤下）。
        */
       export function setupTodoPlugin(ctx) {
         const disposers = []

         // 0) 注册 todo 工具（服务由框架提供；插件级开关默认 true，设置面板可停用）
         if (typeof ctx.inject === 'function') {
           disposers.push(ctx.inject(['inlineMarkers'], (scope) => {
             disposers.push(scope.inlineMarkers.register('todo', {
               description: '任务列表：[[todo:new:...]] 新建 / [[todo:set:...]] 状态 / [[todo:remove:...]] 删除 / [[todo:dep:...]] 依赖 / [[todo:title:...]] 重命名',
               applyOp: applyTodoOp,
             }))
           }))
         }

         // 1) 注入系统提示指引（scoped 服务，走 inject）
         if (typeof ctx.inject === 'function') {
           disposers.push(ctx.inject(['systemPrompt'], (scope) => {
             disposers.push(scope.systemPrompt.section({
               name: 'marker-tools:inline-todo',
               order: 150,
               text: GUIDANCE,
             }))
           }))
         }

         // 2) 兜底：环绕替换 todo_write 执行（restrict 之后模型通常不再调用，此处防旧调用）
         const replacer = createTodoWriteReplacer()
         disposers.push(ctx.on('tools/execute', (exec, next) => replacer(exec, next), true))

         // 3) 完全替换：把 todo_write 从每个 agent 的可见工具中移除（模型看不到、
         //    不会调用，todo 全部走内联标记，少一次工具往返）。
         //    - 既有 agent：agents 服务可用时立即处理（bundle 先于 agent 注册，双保险）
         //    - 未来 agent：监听 agent/created（无标签监听器收得到 scoped 事件）
         if (typeof ctx.inject === 'function') {
           disposers.push(ctx.inject(['agents'], (scope) => {
             try {
               for (const agent of scope.agents.list()) {
                 const d = restrictTodoWrite(agent)
                 if (d) disposers.push(d)
               }
             } catch { /* agents 注册表尚未就绪 */ }
           }))
         }
         disposers.push(ctx.on('agent/created', (payload) => {
           const agent = payload && payload.agent
           const d = restrictTodoWrite(agent)
           if (d) disposers.push(d)
         }))

         return () => {
           for (const d of disposers) {
             try { d() } catch { /* ignore */ }
           }
         }
       }
