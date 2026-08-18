/**
 * Shell label tweaks.
 *
 * Some shipped header strings are hard-coded (e.g. the session-log-export
 * button's "Session log" is a literal in dsh-session-log-export, not a locale
 * key), so a locale override cannot reach them. This module rewrites the
 * exact leaf text via a MutationObserver so the change survives re-renders
 * and session switches.
 */

/** Replace the header's "Session log" label with "log". */
export function replaceSessionLogLabel(): () => void {
  const apply = () => {
    const header = document.querySelector('[data-slot="conversation.session.header"]')
    if (!header) return
    for (const el of header.querySelectorAll('span, button')) {
      if (el.children.length === 0 && (el.textContent || '').trim() === 'Session log') {
        el.textContent = 'log'
      }
    }
  }
  apply()
  const mo = new MutationObserver(() => apply())
  mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  return () => mo.disconnect()
}
