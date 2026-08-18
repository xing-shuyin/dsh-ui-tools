/**
 * 主题跟随 — 适配 dsh web 的亮 / 暗 / 跟随系统切换。
 *
 * dsh 的 theme presenter 把解析后的主题统一落到 `body[data-ds-dark-theme]`
 * （暗色时存在该属性，CSS 变量 --dsw-alias-* 在 body / body[data-ds-dark-theme]
 * 上定义）。CSS 层面的 .ut-theme 调色板全部引用这些 token，随属性自动级联，
 * 无需 JS 参与。
 *
 * 这里只给需要 JS 读色的地方（xterm 画布配色）提供一个轻量 observable：
 * 观察 body 上该属性的增删（MutationObserver），主题切换时通知订阅者。
 */

type ThemeListener = (isDark: boolean) => void

let isDark = false
const listeners = new Set<ThemeListener>()

export const themeStore = {
  get(): boolean {
    return isDark
  },
  subscribe(fn: ThemeListener): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

/** 初始化对 `body[data-ds-dark-theme]` 的观察；返回 disposer（插件卸载时调用）。 */
export function initThemeWatch(): () => void {
  const update = () => {
    const dark = document.body.hasAttribute('data-ds-dark-theme')
    if (dark !== isDark) {
      isDark = dark
      for (const fn of listeners) fn(dark)
    }
  }
  update()
  if (typeof MutationObserver === 'undefined') return () => undefined
  const mo = new MutationObserver(update)
  mo.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  return () => mo.disconnect()
}
