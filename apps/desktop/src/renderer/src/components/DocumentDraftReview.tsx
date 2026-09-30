import { useEffect, useRef, useState } from 'react'
import type { DraftArtifact } from '@/lib/api'

const labels: Record<DraftArtifact['kind'], string> = {
  research_brief: 'Research brief',
  comparison: 'Comparison',
  decision_memo: 'Decision memo',
  readme: 'README'
}

type Destination = { token: string; path: string; exists: boolean }

export function DocumentDraftReview({ draft, content }: { draft: DraftArtifact; content: string }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [destination, setDestination] = useState<Destination | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  const chooseDestination = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const selected = await window.api.chooseDocumentDestination(draft.id, draft.filename)
      if (!selected.canceled) {
        setDestination({ token: selected.token, path: selected.path, exists: selected.exists })
      }
    } catch {
      setError('Could not select that destination. Choose another Markdown file path.')
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!destination) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.saveDocument({
        draftId: draft.id,
        filename: draft.filename,
        content,
        destinationToken: destination.token,
        overwrite: destination.exists
      })
      if (result.status === 'exists') {
        setDestination({ ...destination, exists: true })
        setError('A file now exists at this path. Review the destination and confirm replacement.')
      } else {
        setSavedPath(result.path)
      }
    } catch {
      setError('Could not save this draft. Choose another destination and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
      >
        Review and save {labels[draft.kind]}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`draft-title-${draft.id}`}
        onClose={() => setOpen(false)}
        className="fixed inset-0 m-auto w-[min(48rem,calc(100vw-2rem))] max-h-[90vh] overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/60"
      >
        <div className="flex max-h-[90vh] flex-col gap-4 p-5">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 id={`draft-title-${draft.id}`} className="text-lg font-semibold">Review document draft</h2>
              <p className="mt-1 text-xs text-muted-foreground">{draft.filename} · {labels[draft.kind]}</p>
            </div>
            <form method="dialog">
              <button value="close" className="rounded-md px-2 py-1 text-sm hover:bg-accent">Close</button>
            </form>
          </header>
          <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 text-xs leading-relaxed">{content}</pre>
          <div className="space-y-2 text-xs">
            {destination ? (
              <p className="break-all text-muted-foreground">Destination: {destination.path}</p>
            ) : <p className="text-muted-foreground">No file is written until you choose a destination and confirm.</p>}
            {destination?.exists && !savedPath && (
              <p className="font-medium text-amber-700 dark:text-amber-300">This file already exists. The next action will replace it.</p>
            )}
            {savedPath && <p role="status" className="break-all text-green-700 dark:text-green-300">Saved to {savedPath}</p>}
            {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
          </div>
          <footer className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy || !!savedPath} onClick={() => void chooseDestination()}
              className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent disabled:opacity-50">
              Choose destination
            </button>
            {destination && !savedPath && (
              <button type="button" disabled={busy} onClick={() => void save()}
                className="rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50">
                {busy ? 'Saving…' : destination.exists ? 'Confirm replace' : 'Confirm save'}
              </button>
            )}
          </footer>
        </div>
      </dialog>
    </section>
  )
}
