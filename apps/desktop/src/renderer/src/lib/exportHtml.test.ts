import { expect, it } from 'vitest'
import { chatToHtml } from './exportHtml'

it('exports nested headings and only issued safe source links outside code fences', () => {
  const html = chatToHtml('Research', [{ sender: 'assistant', timestamp: '',
    content: '#### 3.3 Dynamic tools\n[S1, S3] [S9]\n```md\n#### literal\n```',
    sources: [
      { source_id: 'S1', url: 'https://example.org/first' },
      { source_id: 'S3', url: 'javascript:alert(1)' }
    ] }])
  expect(html).toContain('<h4>3.3 Dynamic tools</h4>')
  expect(html).toContain('href="https://example.org/first"')
  expect(html).not.toContain('href="javascript:')
  expect(html).toContain('<pre><code>#### literal</code></pre>')
  expect(html).not.toContain('<h4>literal</h4>')
})
