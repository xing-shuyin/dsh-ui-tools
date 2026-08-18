/**
 * Right-column width control.
 *
 * The shipped layout controller (`ctx.layout`) turns out unreliable from
 * profile-level plugins in this deployment — its openDetails/closeDetails
 * call the store actions, but the attached actions are detached from the
 * rendered layout store (verified: nothing changes). So we drive the right
 * `details` column width deterministically instead:
 *
 *   - a CSS rule with `!important` overrides the layout frame's inline
 *     `grid-template-columns` with two custom properties;
 *   - `--ut-sidebar-px` mirrors the store's sidebar width, read from the
 *     frame's own inline style (React rewrites it on every store change and a
 *     MutationObserver syncs our variable), so the sidebar keeps working;
 *   - `--ut-details-px` is 380px while the panel is open and 0px when
 *     collapsed — the collapse/reopen buttons control it directly.
 */

let frame: HTMLElement | null = null
let observer: MutationObserver | null = null
let detailsOpen = true
let attempts = 0

/** The width the right panel uses while open (wide enough for pi-web-ui's
 *  two-pane terminal/git layouts: side 250/300 + the main pane). */
export const PANEL_WIDTH_PX = 620

function sync(): void {
  if (!frame) return
  const cols = frame.style.gridTemplateColumns || ''
  const m = cols.match(/^(-?\d+(?:\.\d+)?)px/)
  if (m) frame.style.setProperty('--ut-sidebar-px', `${m[1]}px`)
  frame.style.setProperty('--ut-details-px', detailsOpen ? `${PANEL_WIDTH_PX}px` : '0px')
}

function findFrame(): boolean {
  if (frame && frame.isConnected) return true
  frame = null
  observer?.disconnect()
  observer = null
  // The layout frame is the only element with an inline grid-template-columns.
  const el = document.querySelector<HTMLElement>('div[style*="grid-template-columns"]')
  if (!el) return false
  frame = el
  el.setAttribute('data-ut-layout', '')
  sync()
  observer = new MutationObserver(sync)
  observer.observe(el, { attributes: true, attributeFilter: ['style'] })
  return true
}

/** Start the controller; retries until the layout frame exists. */
export function initLayoutControl(): () => void {
  const tryFind = () => {
    if (findFrame()) return
    if (attempts < 60) {
      attempts += 1
      setTimeout(tryFind, 500)
    }
  }
  tryFind()
  return () => {
    observer?.disconnect()
    observer = null
    frame = null
  }
}

/** Open (true) or collapse (false) the right panel. */
export function setDetailsOpen(open: boolean): void {
  if (detailsOpen === open) return
  detailsOpen = open
  sync()
}

export function isDetailsOpen(): boolean {
  return detailsOpen
}
