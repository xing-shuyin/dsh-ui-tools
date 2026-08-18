/**
 * dsh-ui-tools — client half entry.
 *
 * Registers three slot contributions:
 *   - details                           → the tools panel, embedded in the
 *                                         layout's right column (no popup)
 *   - conversation.session.header.actions → quick-open buttons
 *   - conversation.input.dock           → the file-mention strip
 *
 * The right column's width is driven by the layout module (CSS !important
 * override) because the shipped layout controller is unreliable from plugins.
 *
 * Styles (plugin CSS + the bundled xterm CSS) are injected as a <style>
 * element owned by this plugin's fiber and removed on teardown.
 */
import * as React from 'react'
import pluginCss from './styles.css'
import xtermCss from '@xterm/xterm/css/xterm.css'
import { Panel } from './Panel'
import { HeaderActions } from './HeaderActions'
import { MentionStrip } from './MentionStrip'
import { initLayoutControl } from './layout'

export const name = 'dsh-ui-tools'

// Declaring slots/workspaces/sessions as plugin-level hard dependencies makes
// the client framework wait for them and expose them on ctx directly.
export const inject = ['slots', 'workspaces', 'sessions']

export function apply(ctx: any) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dsh-ui-tools')
    style.textContent = `${pluginCss}\n${xtermCss}`
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-ui-tools: styles')

  ctx.effect(() => initLayoutControl(), 'dsh-ui-tools: layout width')

  const slots = ctx.slots
  const workspacesSvc = ctx.workspaces
  const sessionsSvc = ctx.sessions

  // The tools panel is embedded in the layout's right `details` column (no
  // popup); its width is controlled by the layout module. `details` is a
  // single-kind slot occupied by the shipped DetailsPanel at priority 0; the
  // lowest priority renders, so -1 shadows it.
  slots.inject('details', () =>
    slots.register(
      { name: 'details', priority: -1 },
      (props: unknown) => React.createElement(Panel, {
        ...(props as Record<string, never>),
        workspaces: workspacesSvc,
        sessions: sessionsSvc,
      }),
    ),
  )

  slots.inject('conversation.session.header.actions', () =>
    slots.register(
      { name: 'conversation.session.header.actions', id: 'dsh-ui-tools.header', order: 30 },
      () => React.createElement(HeaderActions),
    ),
  )

  slots.inject('conversation.input.dock', () =>
    slots.register(
      { name: 'conversation.input.dock', id: 'dsh-ui-tools.mentions', order: 30 },
      (props: unknown) => React.createElement(MentionStrip, props as Record<string, never>),
    ),
  )
}
