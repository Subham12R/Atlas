# Plan: use indexed documents in chat replies

Status: proposed, not started. Today the Library search is standalone; the UI says
"documents are not yet used in chat replies."

## Goal

When the user asks a question, relevant chunks from their selected, indexed documents
are given to the model as evidence, cited inline (like web `[S1]` and attachment `[A1]`
citations), and shown as context cards under the reply.

## Server

- Retrieve the top-k chunks from the existing document index (`/documents/search`
  backend) for the turn's prompt. Bound the evidence by k and by total characters.
- Hand them to the model the same way attached files are handled in
  `agents/runner.py` (an `evidence` turn), with IDs `D1..Dn`.
- Emit a `document.found` agent event per chunk used, plus a `documents` list on
  `run.completed`, so the renderer can save them on the message.
- Only chunks the reply actually cites get shown as citations. Uncited chunks
  appear as "context considered", never as sources.

## Renderer

- Add `D\d+` to the citation regex in `ChatArea.parseInlineStyles`.
- Save `documentSources` on the message. Render them with `ContextCard`
  (`components/ai/context-card.tsx`), and clicking one opens the Library at that chunk.
- Add `document.found` to `lib/agent-events.mjs` `EVENT_TYPES` and its `.d.mts` type.

## Privacy boundary (decide before building)

- Opt-in per chat, or global in Profile? Recommended: global toggle, default off.
- Cloud providers receive the chunk text. Show which provider saw which documents.
  The local-model Auto route never sends chunks off the machine.
- Removing a document's index must also stop its chunks from being retrieved.
  Past replies keep their saved citations as text.

## Acceptance checks

- A reply that cites `[D1]` shows a document card, and the card resolves to the right chunk.
- With the toggle off, no chunk text appears in any provider request (server test).
- Removed documents are never retrieved (server test).
