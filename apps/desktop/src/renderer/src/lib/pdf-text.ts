/** Text extraction for PDFs, so they travel the same path as .txt/.md files.
 * Only the text layer is read: scanned (image-only) PDFs have none and are rejected. */
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/** Raw PDFs are mostly images and fonts; the extracted text is what limits apply to. */
export const MAX_PDF_BYTES = 25 * 1024 * 1024

export function isPdf(file: { name: string; type?: string }): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export class PdfTextError extends Error {}

export async function extractPdfText(data: ArrayBuffer): Promise<{ text: string; pages: number }> {
  // PDF.js is large; load it only when a PDF is actually selected.
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: new Uint8Array(data) })
  let doc: Awaited<typeof task.promise>
  try {
    doc = await task.promise
  } catch (err) {
    await task.destroy()
    const name = (err as { name?: string })?.name
    throw new PdfTextError(
      name === 'PasswordException'
        ? 'This PDF is password-protected.'
        : 'This file could not be read as a PDF.'
    )
  }
  try {
    const pages: string[] = []
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '')
      }
      page.cleanup()
      // Page markers let answers cite where a passage came from.
      if (text.trim()) pages.push(`[Page ${number}]\n${text.replace(/[ \t]+\n/g, '\n').trim()}`)
    }
    if (pages.length === 0) {
      throw new PdfTextError('This PDF has no selectable text (it may be a scanned image).')
    }
    return { text: pages.join('\n\n'), pages: doc.numPages }
  } finally {
    await task.destroy()
  }
}
