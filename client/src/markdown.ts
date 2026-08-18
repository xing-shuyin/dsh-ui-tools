/**
 * A tiny, dependency-free Markdown renderer for the file preview.
 * Escapes HTML first, then applies block/inline transforms on the escaped
 * text — no raw HTML passes through.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(text: string): string {
  let out = text
  // code spans first
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${t}</strong>`)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, (_m, pre, t) => `${pre}<em>${t}</em>`)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const safe = href.replace(/^(javascript|data|vbscript):/i, '#')
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${label}</a>`
  })
  return out
}

function renderFence(lines: string[], i: number): { html: string; next: number } {
  const lang = lines[i].slice(3).trim()
  const body: string[] = []
  let j = i + 1
  while (j < lines.length && !/^\s*```/.test(lines[j])) {
    body.push(lines[j])
    j += 1
  }
  const html = `<pre class="ut-md-code"><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`
  return { html, next: j + 1 }
}

function renderList(lines: string[], i: number): { html: string; next: number } {
  const ordered = /^\s*\d+[.)]\s/.test(lines[i])
  const items: string[] = []
  let j = i
  while (j < lines.length) {
    const m = lines[j].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/)
    if (!m) break
    items.push(`<li>${inline(m[2])}</li>`)
    j += 1
  }
  const tag = ordered ? 'ol' : 'ul'
  return { html: `<${tag}>${items.join('')}</${tag}>`, next: j }
}

/** Render markdown text to (escaped) HTML. */
export function renderMarkdown(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (/^\s*```/.test(line)) {
      const r = renderFence(lines, i)
      out.push(r.html)
      i = r.next
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const r = renderList(lines, i)
      out.push(r.html)
      i = r.next
      continue
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      const level = trimmed.match(/^(#{1,6})/)[1].length
      const title = trimmed.slice(level).trim()
      out.push(`<h${level}>${inline(escapeHtml(title))}</h${level}>`)
      i += 1
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const block: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        block.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push(`<blockquote>${escapeHtml(block.join('<br>'))}</blockquote>`)
      continue
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push('<hr>')
      i += 1
      continue
    }
    if (trimmed === '') {
      i += 1
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,6}\s+/.test(lines[i].trim()) && !/^\s*```/.test(lines[i])) {
      para.push(lines[i])
      i += 1
    }
    out.push(`<p>${inline(escapeHtml(para.join(' ')))}</p>`)
  }
  return out.join('\n')
}
