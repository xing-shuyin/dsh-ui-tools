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
 *   - `--ut-details-px` is the panel width while open (default 620px, user
 *     draggable) and 0px when collapsed. The width persists in localStorage.
 */

let frame: HTMLElement | null = null
let observer: MutationObserver | null = null
let detailsOpen = true
let attempts = 0

/** Width bounds for the draggable panel. */
export const PANEL_MIN_WIDTH = 360
export const PANEL_MAX_WIDTH = 900
/** Default open width (wide enough for pi-web-ui two-pane terminal/git). */
export const PANEL_WIDTH_PX = 620

function loadSavedWidth(): number {
  try {
    const saved = Number(localStorage.getItem('dsh-ui-tools.panel.width'))
    if (Number.isFinite(saved) && saved >= PANEL_MIN_WIDTH && saved <= PANEL_MAX_WIDTH) return Math.round(saved)
  } catch { /* ignore */ }
  return PANEL_WIDTH_PX
}

let detailsWidth = loadSavedWidth()

function sync(): void {
  if (!frame) return
  const cols = frame.style.gridTemplateColumns || ''
  const m = cols.match(/^(-?\d+(?:\.\d+)?)px/)
  if (m) frame.style.setProperty('--ut-sidebar-px', `${m[1]}px`)
  frame.style.setProperty('--ut-details-px', detailsOpen ? `${detailsWidth}px` : '0px')
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

/** Current open width of the panel (for the drag handle's base). */
export function getDetailsWidth(): number {
  return detailsWidth
}

/** Set the open width (dragging), clamped to the panel bounds and persisted. */
export function setDetailsWidth(px: number): void {
  const clamped = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(px)))
  if (clamped === detailsWidth) return
  detailsWidth = clamped
  detailsOpen = true
  try {
    localStorage.setItem('dsh-ui-tools.panel.width', String(clamped))
  } catch { /* ignore */ }
  sync()
}
