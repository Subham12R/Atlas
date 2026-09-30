import { useEffect, useState, type FormEvent } from 'react'
import {
  deleteDocument,
  friendlyErrorMessage,
  ingestDocument,
  listDocuments,
  searchDocuments,
  type DocumentHit,
  type IndexedDocument
} from '@/lib/api'
import { ContextCard } from '@/components/ai/context-card'

const MAX_BYTES = 1024 * 1024

export default function DocumentLibrary(): React.JSX.Element {
  const [documents, setDocuments] = useState<IndexedDocument[]>([])
  const [results, setResults] = useState<DocumentHit[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    let mounted = true
    listDocuments().then(
      (docs) => {
        if (mounted) setDocuments(docs)
      },
      (err) => {
        if (mounted) setError(friendlyErrorMessage(err, 'Document index unavailable.'))
      }
    )
    return () => {
      mounted = false
    }
  }, [])

  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setError('')
    if (!/\.(txt|md)$/i.test(file.name) || file.size > MAX_BYTES || file.size === 0) {
      setError('Select a non-empty .txt or .md file up to 1 MiB.')
      return
    }
    setBusy(true)
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const { source_id } = await ingestDocument(file.name, text)
      setDocuments((previous) =>
        previous.some((doc) => doc.source_id === source_id)
          ? previous
          : [{ source_id, name: file.name, byte_size: file.size }, ...previous]
      )
      setStatus(`${file.name} indexed.`)
    } catch (err) {
      setError(friendlyErrorMessage(err, 'Could not index this UTF-8 text file.'))
    } finally {
      setBusy(false)
    }
  }

  const search = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!query.trim()) return
    setError('')
    try {
      setResults(await searchDocuments(query.trim()))
    } catch (err) {
      setError(friendlyErrorMessage(err, 'Document search unavailable.'))
    }
  }

  const remove = async (document: IndexedDocument): Promise<void> => {
    setError('')
    try {
      await deleteDocument(document.source_id)
      setDocuments((previous) => previous.filter((item) => item.source_id !== document.source_id))
      setResults((previous) => previous.filter((hit) => hit.source_id !== document.source_id))
      setStatus(`${document.name} removed from index. The original file is unchanged.`)
    } catch (err) {
      setError(friendlyErrorMessage(err, 'Could not remove this document.'))
    }
  }

  return (
    <section
      aria-labelledby="documents-heading"
      className="mx-auto max-w-3xl space-y-3 border-t border-[#E5E3DF] px-6 py-5 dark:border-[#4d4d4d]"
    >
      <h2 id="documents-heading" className="text-sm font-semibold">
        Selected documents
      </h2>
      <p className="text-xs text-muted-foreground">
        Only selected UTF-8 .txt/.md files, up to 1 MiB. Removing an index does not delete your
        file.
      </p>
      <label htmlFor="document-file" className="block text-xs font-medium">
        Select a text document
      </label>
      <input
        id="document-file"
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        disabled={busy}
        onChange={(event) => {
          void upload(event.target.files?.[0])
          event.target.value = ''
        }}
        className="block w-full text-xs focus-visible:outline-2 focus-visible:outline-offset-2"
      />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {status}
      </p>
      <ul className="space-y-2">
        {documents.map((document) => (
          <li key={document.source_id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{document.name}</span>
            <button
              type="button"
              onClick={() => void remove(document)}
              aria-label={`Remove index for ${document.name}`}
              className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 focus-visible:outline-2"
            >
              Remove index
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Search matches text in indexed chunks; documents are not yet used in chat replies.
      </p>
      <form onSubmit={(event) => void search(event)} className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="document-search" className="block text-xs font-medium">
            Search documents
          </label>
          <input
            id="document-search"
            type="search"
            maxLength={512}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded border border-[#E5E3DF] bg-transparent px-2 py-1 text-sm dark:border-[#4d4d4d]"
          />
        </div>
        <button
          type="submit"
          className="rounded border border-[#E5E3DF] px-3 py-1 text-sm focus-visible:outline-2 dark:border-[#4d4d4d]"
        >
          Search documents
        </button>
      </form>
      <ul className="grid gap-2 sm:grid-cols-2">
        {results.map((hit) => (
          <li key={`${hit.source_id}-${hit.chunk_id}`}>
            <ContextCard
              label={`${hit.name} · chunk ${hit.chunk_id}`}
              meta={`ID ${hit.source_id.slice(0, 8)} · score ${hit.score.toFixed(3)}`}
            >
              {hit.text}
            </ContextCard>
          </li>
        ))}
      </ul>
    </section>
  )
}
