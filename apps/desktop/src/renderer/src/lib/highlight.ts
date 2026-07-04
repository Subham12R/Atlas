import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'

// A curated subset, not the full ~190-language bundle -- keeps the app's
// bundle size sane while covering what a coding assistant actually produces.
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('java', java)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', cpp)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('markdown', markdown)

export interface HighlightResult {
  html: string
  language: string
  /** The plain-text source actually highlighted -- same as the input, except
   * pretty-printed when it was reformatted as JSON. Use this for "copy code". */
  source: string
}

/** If `code` parses as JSON, pretty-prints it first (models don't always
 * indent their own JSON output) before syntax highlighting it as such. */
export function highlightCode(code: string, lang?: string): HighlightResult {
  let source = code
  let language = lang?.toLowerCase().trim() || ''

  if (language === 'json' || (!language && looksLikeJson(source))) {
    try {
      source = JSON.stringify(JSON.parse(source), null, 2)
      language = 'json'
    } catch {
      // not actually valid JSON -- fall through and highlight as-is
    }
  }

  if (language && hljs.getLanguage(language)) {
    const { value } = hljs.highlight(source, { language })
    return { html: value, language, source }
  }

  const auto = hljs.highlightAuto(source)
  return { html: auto.value, language: auto.language || 'text', source }
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  )
}
