export async function runSearchBeforeChat({ query, maxResults, signal, search }) {
  if (signal.aborted) throw new DOMException('Search cancelled', 'AbortError')
  const { results } = await search(query, maxResults, signal)
  if (signal.aborted) throw new DOMException('Search cancelled', 'AbortError')
  return results
}
