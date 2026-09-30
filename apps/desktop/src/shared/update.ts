export type UpdateResult =
  | { status: 'current'; current: string }
  | {
      status: 'available'
      current: string
      latest: string
      name: string
      notes: string
      publishedAt: string | null
      hasDownload: boolean
    }
  | { status: 'error'; current: string; message: string }
