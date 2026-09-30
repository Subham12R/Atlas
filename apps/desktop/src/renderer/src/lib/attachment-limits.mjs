export function attachmentLimitError(files, existing = []) {
  if (files.length + existing.length > 5) return 'Attach at most 5 text files.'
  if (files.some((file) => file.size > 5 * 1024 * 1024)) return 'Each text file must be at most 5 MiB.'
  if ([...files, ...existing].reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) {
    return 'Text attachments must total at most 10 MiB.'
  }
  return null
}
