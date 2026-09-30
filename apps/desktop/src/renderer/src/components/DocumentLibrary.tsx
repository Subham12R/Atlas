import { useEffect, useState, type FormEvent } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, File01Icon, Search01Icon, Upload01Icon } from '@hugeicons/core-free-icons'
import { RichButton } from '@/components/rich-button'
import { cn } from '@/lib/utils'
import {
  deleteDocument,
  friendlyErrorMessage,
  ingestDocument,
  listDocuments,
  searchDocuments,
  type DocumentHit,
  type IndexedDocument
} from '@/lib/api'

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
    <section aria-labelledby="documents-heading" className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2
            id="documents-heading"
            className="text-sm font-semibold text-[#2E2E2D] dark:text-[#EAE8E3]"
          >
            Selected documents
          </h2>
          <p className="text-xs text-[#6E6D6A] dark:text-[#9E9D9A]">
            UTF-8 .txt/.md files up to 1 MiB. Removing an index never deletes your file.
          </p>
        </div>
        {/* Native file input kept for keyboard/AT; the rich label is the visible control. */}
        <input
          id="document-file"
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          disabled={busy}
          onChange={(event) => {
            void upload(event.target.files?.[0])
            event.target.value = ''
          }}
          className="peer sr-only"
        />
        <RichButton
          asChild
          color="soft"
          size="sm"
          className={cn(
            'shrink-0 text-xs peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
            busy && 'pointer-events-none opacity-50'
          )}
        >
          <label htmlFor="document-file" aria-disabled={busy || undefined}>
            <HugeiconsIcon icon={Upload01Icon} size={14} />
            {busy ? 'Indexing…' : 'Select a text document'}
          </label>
        </RichButton>
      </div>

      {error && (
        <p role="alert" className="text-xs text-[#E0533C] dark:text-[#F87171]">
          {error}
        </p>
      )}
      <p aria-live="polite" className="text-xs text-[#6E6D6A] empty:hidden dark:text-[#9E9D9A]">
        {status}
      </p>

      {documents.length > 0 ? (
        <ul className="divide-y divide-[#E5E3DF] overflow-hidden rounded-xl border border-[#E5E3DF] dark:divide-[#2C2C2A] dark:border-[#2C2C2A]">
          {documents.map((document) => (
            <li key={document.source_id} className="flex items-center gap-3 px-3 py-2">
              <HugeiconsIcon
                icon={File01Icon}
                size={15}
                className="shrink-0 text-[#6E6D6A] dark:text-[#9E9D9A]"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-[#2E2E2D] dark:text-[#EAE8E3]">
                {document.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#9E9D9A]">
                {(document.byte_size / 1024).toFixed(1)} KB
              </span>
              <RichButton
                type="button"
                color="soft"
                size="sm"
                onClick={() => void remove(document)}
                aria-label={`Remove index for ${document.name}`}
                className="h-7 shrink-0 px-2.5 text-xs text-red-600 dark:text-red-400"
              >
                <HugeiconsIcon icon={Delete02Icon} size={13} />
                Remove
              </RichButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-[#E5E3DF] px-3 py-4 text-center text-xs text-[#9E9D9A] dark:border-[#2C2C2A]">
          No documents indexed yet.
        </p>
      )}

      <form onSubmit={(event) => void search(event)} className="space-y-1.5">
        <label htmlFor="document-search" className="sr-only">
          Search documents
        </label>
        <div className="flex h-10 items-center gap-2 rounded-xl bg-[#F1EFEA] pl-3 pr-1 dark:bg-[#2C2C2A]">
          <HugeiconsIcon
            icon={Search01Icon}
            size={16}
            className="shrink-0 text-[#6E6D6A] dark:text-[#9E9D9A]"
          />
          <input
            id="document-search"
            type="search"
            maxLength={512}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search indexed text…"
            className="min-w-0 flex-1 bg-transparent text-sm text-[#2E2E2D] outline-none placeholder:text-[#9E9D9A] dark:text-[#EAE8E3]"
          />
          <RichButton type="submit" size="sm" className="h-8 shrink-0 px-3 text-xs">
            Search documents
          </RichButton>
        </div>
        <p className="px-1 text-[11px] text-[#9E9D9A]">
          Matches text in indexed chunks. Documents are not yet used in chat replies.
        </p>
      </form>

      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((hit) => (
            <li
              key={hit.chunk_id}
              className="overflow-hidden rounded-xl border border-[#E5E3DF] dark:border-[#2C2C2A]"
            >
              <div className="flex items-center gap-2 border-b border-[#E5E3DF] px-3 py-1.5 dark:border-[#2C2C2A]">
                <span className="min-w-0 truncate text-xs font-medium text-[#2E2E2D] dark:text-[#EAE8E3]">
                  {hit.name} · chunk {hit.chunk_id}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-[#9E9D9A]">
                  {hit.source_id.slice(0, 8)} · {hit.score.toFixed(3)}
                </span>
              </div>
              <p className="line-clamp-3 px-3 py-2 text-xs leading-relaxed text-[#6E6D6A] dark:text-[#9E9D9A]">
                {hit.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
