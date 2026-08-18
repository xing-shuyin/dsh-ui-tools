/**
 * 声音提示设置 — 移植自 pi-web-ui 的 web/src/components/SoundSettings.tsx，
 * 以区块形式嵌入工具面板的「设置」页（非下拉弹层）。
 *
 * 总开关 + 每个事件的开关/试听 + 主音量滑条；改动即写 localStorage，
 * 提示音监听器实时读取，无需重启。
 */
import * as React from 'react'
import {
  loadSoundSettings,
  playSound,
  saveSoundSettings,
  type SoundKind,
  type SoundSettings,
} from './sounds'

const SOUND_EVENTS: {
  kind: SoundKind
  label: string
  desc: string
}[] = [
  { kind: 'question', label: '提问/审批弹窗', desc: 'ask_user_question 提问或审批请求出现时' },
  { kind: 'done', label: '运行完成', desc: '一轮运行结束（agent 回到空闲）' },
  { kind: 'start', label: '开始运行', desc: '一轮运行开始（agent 开始处理）' },
  { kind: 'error', label: '出错', desc: '回合失败或会话报错时' },
]

export function SoundSettingsSection() {
  const [settings, setSettings] = React.useState<SoundSettings>(loadSoundSettings)

  const toggle = (patch: Partial<SoundSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSoundSettings(next)
      return next
    })
  }

  const preview = (kind: SoundKind) => {
    // 用当前设置直接播放 — 同时承担“解锁 AudioContext”的手势职责。
    playSound(kind, settings)
  }

  return (
    <div className="ut-sound-section">
      <div className="ut-sound-head">
        <div className="ut-sound-title">声音提示</div>
        <div className="ut-sound-desc">
          在提问/完成/出错等时刻播放提示音（Web Audio 合成，无音频文件，设置保存在本机浏览器）
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-info">
          <div className="settings-label">启用声音</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          className={`ut-switch${settings.enabled ? ' on' : ''}`}
          onClick={() => toggle({ enabled: !settings.enabled })}
          title={settings.enabled ? '点击关闭所有提示音' : '点击启用提示音'}
        >
          <span className="ut-switch-knob" />
        </button>
      </div>

      {SOUND_EVENTS.map(({ kind, label, desc }) => (
        <div key={kind} className={`ut-sound-row${settings.enabled ? '' : ' disabled'}`}>
          <div className="ut-sound-label">
            <div className="ut-sound-name">{label}</div>
            <div className="ut-sound-desc2">{desc}</div>
          </div>
          <div className="ut-sound-right">
            <button
              type="button"
              className="ut-sound-preview"
              title="试听"
              disabled={!settings.enabled}
              onClick={() => preview(kind)}
            >
              试听
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={settings[kind]}
              className={`ut-switch${settings[kind] ? ' on' : ''}`}
              disabled={!settings.enabled}
              onClick={() => toggle({ [kind]: !settings[kind] })}
            >
              <span className="ut-switch-knob" />
            </button>
          </div>
        </div>
      ))}

      <div className={`ut-sound-vol${settings.enabled ? '' : ' disabled'}`}>
        <span className="ut-sound-name">音量</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={settings.volume}
          disabled={!settings.enabled}
          onChange={(e) => toggle({ volume: Number(e.target.value) })}
        />
        <span className="ut-sound-vol-num">{settings.volume}%</span>
      </div>
    </div>
  )
}
