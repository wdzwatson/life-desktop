import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

type VideoPathRow = {
  id: number
  local_path: string | null
  path: string | null
}

export type DeleteVideoRecordsInput = {
  videoIds: unknown[]
  deleteLocalFiles: boolean
  videoDirectory: string
}

export type DeleteVideoRecordsResult = {
  deletedRecordCount: number
  deletedFileCount: number
  missingFileCount: number
  retainedSharedFileCount: number
}

function normalizeVideoIds(values: unknown[]) {
  const ids = [...new Set(values.map(Number))]
  if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Valid video IDs are required.')
  }
  return ids
}

function getStoredVideoPath(row: VideoPathRow) {
  return row.local_path?.trim() || row.path?.trim() || ''
}

function getPathIdentity(filePath: string) {
  const resolvedPath = path.resolve(filePath)
  return process.platform === 'win32' || process.platform === 'darwin'
    ? resolvedPath.toLocaleLowerCase('en-US')
    : resolvedPath
}

function resolveManagedVideoPath(videoDirectory: string, storedPath: string) {
  const allowedRoot = path.resolve(videoDirectory)
  const resolvedPath = path.resolve(storedPath)
  const relative = path.relative(allowedRoot, resolvedPath)
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('The local video path is outside the video directory.')
  }
  return resolvedPath
}

export function deleteVideoRecords(
  db: Database.Database,
  input: DeleteVideoRecordsInput,
): DeleteVideoRecordsResult {
  const videoIds = normalizeVideoIds(input.videoIds)
  const selectedIds = new Set(videoIds)
  const allRows = db
    .prepare('SELECT id, local_path, path FROM videos')
    .all() as VideoPathRow[]
  const selectedRows = allRows.filter((row) => selectedIds.has(row.id))

  let deletedFileCount = 0
  let missingFileCount = 0
  let retainedSharedFileCount = 0

  if (input.deleteLocalFiles) {
    const retainedPaths = new Set(
      allRows
        .filter((row) => !selectedIds.has(row.id))
        .map(getStoredVideoPath)
        .filter(Boolean)
        .map(getPathIdentity),
    )
    const selectedPaths = new Set(
      selectedRows
        .map(getStoredVideoPath)
        .filter(Boolean)
        .map((storedPath) => resolveManagedVideoPath(input.videoDirectory, storedPath)),
    )

    for (const filePath of selectedPaths) {
      if (retainedPaths.has(getPathIdentity(filePath))) {
        retainedSharedFileCount += 1
        continue
      }
      try {
        fs.unlinkSync(filePath)
        deletedFileCount += 1
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          missingFileCount += 1
          continue
        }
        throw error
      }
    }
  }

  const placeholders = videoIds.map(() => '?').join(', ')
  const deleteRows = db.transaction(() =>
    db.prepare(`DELETE FROM videos WHERE id IN (${placeholders})`).run(...videoIds),
  )
  const deleteResult = deleteRows()

  return {
    deletedRecordCount: deleteResult.changes,
    deletedFileCount,
    missingFileCount,
    retainedSharedFileCount,
  }
}
