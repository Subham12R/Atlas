import type { SearchResult } from './api'

export function runSearchBeforeChat(options: {
  query: string
  maxResults: number
  signal: AbortSignal
  search: (query: string, maxResults: number, signal: AbortSignal) => Promise<{ results: SearchResult[] }>
}): Promise<SearchResult[]>
