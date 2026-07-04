// Plain-HTML-string rendering of a chat for PDF export -- a parallel, simpler
// version of ChatArea's React-based markdown parser, since printToPDF needs
// a standalone HTML document rather than React nodes.

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function markdownToHtml(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inCode = false
  let codeLines: string[] = []
  let listItems: string[] = []

  const flushList = (): void => {
    if (listItems.length) {
      out.push('<ul>' + listItems.map((i) => `<li>${inlineToHtml(i)}</li>`).join('') + '</ul>')
      listItems = []
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
        codeLines = []
      }
      inCode = !inCode
      continue
    }
    if (inCode) {
      codeLines.push(line)
      continue
    }
    if (line.startsWith('# ')) {
      flushList()
      out.push(`<h1>${inlineToHtml(line.slice(2))}</h1>`)
      continue
    }
    if (line.startsWith('## ')) {
      flushList()
      out.push(`<h2>${inlineToHtml(line.slice(3))}</h2>`)
      continue
    }
    if (line.startsWith('### ')) {
      flushList()
      out.push(`<h3>${inlineToHtml(line.slice(4))}</h3>`)
      continue
    }
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      listItems.push(line.trim().slice(2))
      continue
    }
    flushList()
    out.push(line.trim() === '' ? '<br/>' : `<p>${inlineToHtml(line)}</p>`)
  }
  flushList()
  return out.join('\n')
}

export interface ExportableMessage {
  sender: 'user' | 'assistant'
  content: string
  timestamp: string
}

export function chatToHtml(title: string, messages: ExportableMessage[]): string {
  const body = messages
    .map((m) => {
      const who = m.sender === 'user' ? 'You' : 'Assistant'
      return `<div class="msg ${m.sender}">
        <div class="meta">${escapeHtml(who)} &middot; ${escapeHtml(m.timestamp)}</div>
        <div class="content">${markdownToHtml(m.content)}</div>
      </div>`
    })
    .join('\n')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; color: #1A1A19; margin: 40px; }
  h1.title { font-size: 20px; margin-bottom: 24px; }
  .msg { margin-bottom: 20px; }
  .msg .meta { font-size: 11px; color: #6E6D6A; margin-bottom: 4px; }
  .msg.user .content { font-weight: 500; }
  .content p { margin: 6px 0; line-height: 1.5; font-size: 13px; }
  .content h1, .content h2, .content h3 { margin: 16px 0 8px; }
  .content pre { background: #F1EFEA; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 11px; }
  .content code { font-family: "SF Mono", Consolas, monospace; }
  .content ul { padding-left: 20px; }
</style>
</head>
<body>
  <h1 class="title">${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`
}
