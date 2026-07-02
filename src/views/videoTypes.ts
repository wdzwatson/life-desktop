export interface VideoRecord {
  id: number
  title: string
  group_id?: number | null
  status?: string
  local_path?: string
  path?: string
  duration?: string
  source?: string
  tags?: string[]
}

export interface VideoFilter {
  query: string
  groupId: number | null | 'all' | 'downloaded' | 'downloading'
  tag: string | null
}
