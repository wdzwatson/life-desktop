import type Database from 'better-sqlite3'
import type { AIConversationService } from './conversationService'

type RecoverableAssetRow = {
  id: number
  run_id: number
}

export type AIRecoveryServiceDependencies = {
  db: Database.Database
  conversations: Pick<AIConversationService, 'interruptUnfinishedRuns'>
  resumeVideo: (assetId: number, signal?: AbortSignal) => Promise<unknown>
  now?: () => Date
}

export class AIRecoveryService {
  private readonly now: () => Date

  constructor(private readonly dependencies: AIRecoveryServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date())
  }

  async recover(signal?: AbortSignal) {
    const recoverable = this.dependencies.db.prepare(`
      SELECT id, run_id
      FROM ai_media_assets
      WHERE media_type = 'video'
        AND status IN ('generating', 'polling', 'downloading', 'processing')
        AND provider_task_id IS NOT NULL
        AND run_id IS NOT NULL
        AND assistant_message_id IS NOT NULL
      ORDER BY id
    `).all() as RecoverableAssetRow[]
    const interruptedRuns = this.dependencies.conversations.interruptUnfinishedRuns({
      excludeRunIds: recoverable.map((row) => row.run_id),
    })
    const now = this.now().toISOString()
    const exclusion = recoverable.length > 0
      ? `AND id NOT IN (${recoverable.map(() => '?').join(', ')})`
      : ''
    const unrecoverable = this.dependencies.db.prepare(`
      SELECT id FROM ai_media_assets
      WHERE status IN ('queued', 'generating', 'polling', 'downloading', 'processing')
        ${exclusion}
      ORDER BY id
    `).all(...recoverable.map((row) => row.id)) as Array<{ id: number }>
    if (unrecoverable.length > 0) {
      const update = this.dependencies.db.prepare(`
        UPDATE ai_media_assets
        SET status = 'interrupted', error_code = 'cancelled',
          error_message = 'The previous application session ended before this media task could be recovered.',
          updated_at = ?
        WHERE id = ? AND status IN ('queued', 'generating', 'polling', 'downloading', 'processing')
      `)
      this.dependencies.db.transaction(() => {
        for (const row of unrecoverable) update.run(now, row.id)
      })()
    }

    const recoveredAssetIds: number[] = []
    const failedAssetIds: number[] = []
    for (const row of recoverable) {
      if (signal?.aborted) break
      try {
        await this.dependencies.resumeVideo(row.id, signal)
        recoveredAssetIds.push(row.id)
      } catch {
        failedAssetIds.push(row.id)
      }
    }
    return {
      ...interruptedRuns,
      recoverableAssetIds: recoverable.map((row) => row.id),
      recoveredAssetIds,
      failedAssetIds,
      interruptedAssetIds: unrecoverable.map((row) => row.id),
    }
  }
}
