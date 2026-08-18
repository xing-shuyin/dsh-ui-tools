/**
 * dsh-ui-tools 声音提示（移植自 pi-web-ui 的 web/src/sounds.ts）。
 *
 * 所有提示音都用 Web Audio API 合成（无音频资源文件），整块功能 ~1KB、
 * 离线可用。设置持久化在 localStorage；工具面板「设置」页提供配置入口。
 */

export interface SoundSettings {
  /** 总开关 — 关闭后所有提示音都不再播放。 */
  enabled: boolean
  /** 提问/审批弹窗出现（ask_user_question 等需要用户介入的交互）。 */
  question: boolean
  /** 一轮运行结束（agent 从 running 回到 idle）。 */
  done: boolean
  /** 一轮运行开始（agent 开始运行）。 */
  start: boolean
  /** 回合出错（lastAgentError 变为新的非空值）。 */
  error: boolean
  /** 主音量 0–100。 */
  volume: number
}

export type SoundKind = 'question' | 'done' | 'start' | 'error'

const STORAGE_KEY = 'dsh-ui-tools-sounds'

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  question: true,
  done: true,
  start: false,
  error: true,
  volume: 100,
}

/** 读取持久化的设置，任何失败都回退到默认值。 */
export function loadSoundSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SOUND_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<SoundSettings>
    const merged: SoundSettings = { ...DEFAULT_SOUND_SETTINGS, ...parsed }
    // 清洗存储值：损坏或越界的条目不能破坏开关与音量计算。
    for (const k of ['enabled', 'question', 'done', 'start', 'error'] as const) {
      if (typeof merged[k] !== 'boolean') merged[k] = DEFAULT_SOUND_SETTINGS[k]
    }
    if (typeof merged.volume !== 'number' || !Number.isFinite(merged.volume)) {
      merged.volume = DEFAULT_SOUND_SETTINGS.volume
    } else {
      // 钳制 0–100 并对齐滑条步长（5），保证数字标签与滑块位置一致。
      merged.volume = Math.round(Math.max(0, Math.min(100, merged.volume)) / 5) * 5
    }
    return merged
  } catch {
    return { ...DEFAULT_SOUND_SETTINGS }
  }
}

export function saveSoundSettings(settings: SoundSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // 存储不可用（如隐私模式）— 声音只是不持久化而已
  }
}

// ---------------------------------------------------------------------------
// 音频引擎
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null

/** 惰性创建/恢复共享的 AudioContext（首次调用需要用户手势）。 */
function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

interface Note {
  type: OscillatorType
  freq: number
  /** 距提示音开始的秒数。 */
  start: number
  dur: number
  /** 峰值增益 0–1（再乘以主音量）。 */
  peak: number
}

/** 两个上行音符 — 有提问/审批弹窗进来。 */
const QUESTION: Note[] = [
  { type: 'sine', freq: 587.33, start: 0, dur: 0.13, peak: 0.5 },
  { type: 'sine', freq: 880, start: 0.11, dur: 0.24, peak: 0.5 },
]
/** 两个柔和下行音符 — 工作完成。 */
const DONE: Note[] = [
  { type: 'sine', freq: 880, start: 0, dur: 0.15, peak: 0.35 },
  { type: 'sine', freq: 587.33, start: 0.15, dur: 0.32, peak: 0.35 },
]
/** 一个短促滴答 — 运行开始。 */
const START: Note[] = [
  { type: 'triangle', freq: 660, start: 0, dur: 0.08, peak: 0.22 },
]
/** 低音双响 — 出错了。 */
const ERROR: Note[] = [
  { type: 'square', freq: 220, start: 0, dur: 0.16, peak: 0.18 },
  { type: 'square', freq: 174.61, start: 0.18, dur: 0.26, peak: 0.18 },
]

const PATTERNS: Record<SoundKind, Note[]> = {
  question: QUESTION,
  done: DONE,
  start: START,
  error: ERROR,
}

function tone(c: AudioContext, note: Note, volume: number): void {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = note.type
  osc.frequency.value = note.freq
  const t0 = c.currentTime + note.start
  const peak = Math.max(0.0001, note.peak * volume)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + note.dur + 0.05)
}

/**
 * 若当前设置允许则播放一个提示音。在用户交互之前调用是安全的 —
 * 浏览器拦截音频时静默跳过，直到之后某个有手势的调用再生效。
 */
export function playSound(
  kind: SoundKind,
  settings: SoundSettings = loadSoundSettings(),
): void {
  if (!settings.enabled || !settings[kind]) return
  const c = audio()
  if (!c) return
  const volume = Math.max(0, Math.min(1, settings.volume / 100))
  for (const note of PATTERNS[kind]) tone(c, note, volume)
}
