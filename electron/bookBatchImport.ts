import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import AdmZip from 'adm-zip'
import { PDFParse } from 'pdf-parse'

const BOOK_EXTENSIONS = new Set(['.epub', '.pdf', '.mobi', '.txt', '.docx'])
const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

type ExtractedCover = { data: Buffer; extension: string }

export type BatchImportItemStatus = 'pending' | 'success' | 'skipped' | 'failed'
export type BatchImportDuplicateReason = 'existing-book' | 'duplicate-in-queue'

export type BatchImportItem = {
  id: string
  sourcePath: string
  fileName: string
  title: string
  format: string
  coverSourcePath?: string
  coverFileName?: string
  coverConflict: boolean
  duplicateReason?: BatchImportDuplicateReason
}

export type BatchImportItemResult = Pick<
  BatchImportItem,
  'id' | 'fileName' | 'title' | 'format' | 'coverFileName' | 'coverConflict' | 'duplicateReason'
> & {
  status: BatchImportItemStatus
  error?: string
  coverWarning?: string
}

export function normalizeBookImportStem(fileName: string) {
  const extension = path.extname(fileName)
  return path
    .basename(fileName, extension)
    .normalize('NFKC')
    .replace(/[《》\[\](){}（）【】]/g, '')
    .replace(/\s+/g, '')
    .toLocaleLowerCase()
}

export function isSupportedBookFile(fileName: string) {
  return BOOK_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

export function isSupportedBookCover(fileName: string) {
  return COVER_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

function readXmlAttribute(source: string, attribute: string) {
  const match = source.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return match?.[2]
}

function getZipEntryPath(basePath: string, href: string) {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(basePath), href.split('#')[0]))
  return resolved.replace(/^\.\//, '')
}

export function extractEpubCover(sourcePath: string): ExtractedCover | null {
  try {
    const zip = new AdmZip(sourcePath)
    const container = zip.getEntry('META-INF/container.xml')?.getData().toString('utf8')
    const packagePath = container ? readXmlAttribute(container, 'full-path') : undefined
    if (!packagePath) return null
    const packageDocument = zip.getEntry(packagePath)?.getData().toString('utf8')
    if (!packageDocument) return null

    const manifestMatch = packageDocument.match(/<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i)
    if (!manifestMatch) return null
    const manifestItems = Array.from(manifestMatch[1].matchAll(/<item\b[^>]*>/gi)).map((match) => {
      const element = match[0]
      return {
        id: readXmlAttribute(element, 'id'),
        href: readXmlAttribute(element, 'href'),
        mediaType: readXmlAttribute(element, 'media-type'),
        properties: readXmlAttribute(element, 'properties'),
      }
    })
    const coverMeta = packageDocument.match(/<meta\b[^>]*\bname\s*=\s*(["'])cover\1[^>]*>/i)
    const coverItemId = coverMeta ? readXmlAttribute(coverMeta[0], 'content') : undefined
    const coverItem =
      manifestItems.find((item) => item.id === coverItemId) ??
      manifestItems.find((item) => item.properties?.split(/\s+/).includes('cover-image')) ??
      manifestItems.find((item) => /\bcover\b/i.test(item.id ?? ''))
    if (!coverItem?.href) return null

    const entryPath = getZipEntryPath(packagePath, coverItem.href)
    const extension = path.posix.extname(entryPath).toLowerCase()
    if (!COVER_EXTENSIONS.has(extension)) return null
    const entry = zip.getEntry(entryPath)
    return entry ? { data: entry.getData(), extension } : null
  } catch {
    return null
  }
}

export async function extractPdfFirstPageCover(sourcePath: string): Promise<ExtractedCover | null> {
  let parser: PDFParse | undefined
  try {
    parser = new PDFParse({ data: await fs.promises.readFile(sourcePath) })
    const screenshot = await parser.getScreenshot({
      partial: [1],
      desiredWidth: 240,
      imageBuffer: true,
      imageDataUrl: false,
    })
    const firstPage = screenshot.pages[0]
    return firstPage?.data ? { data: Buffer.from(firstPage.data), extension: '.png' } : null
  } catch {
    return null
  } finally {
    await parser?.destroy().catch(() => undefined)
  }
}

export async function createManagedBookCover(input: {
  sourcePath: string
  format: string
  filesRoot: string
  coverSourcePath?: string
}) {
  const embeddedCover =
    !input.coverSourcePath && input.format === 'EPUB' ? extractEpubCover(input.sourcePath) : null
  const pdfFirstPageCover =
    !input.coverSourcePath && !embeddedCover && input.format === 'PDF'
      ? await extractPdfFirstPageCover(input.sourcePath)
      : null
  const automaticCover = embeddedCover ?? pdfFirstPageCover
  if (!input.coverSourcePath && !automaticCover) return null

  const coverExtension = input.coverSourcePath
    ? path.extname(input.coverSourcePath).toLowerCase()
    : automaticCover!.extension
  const coverFileName = `${crypto.randomUUID()}${coverExtension}`
  const coversDir = path.join(input.filesRoot, 'book-covers')
  const coverPath = path.join(coversDir, coverFileName)
  await fs.promises.mkdir(coversDir, { recursive: true })
  if (input.coverSourcePath) await fs.promises.copyFile(input.coverSourcePath, coverPath)
  else await fs.promises.writeFile(coverPath, automaticCover!.data)
  return `/book-covers/${coverFileName}`
}

export function buildBatchImportItems(input: {
  bookPaths: string[]
  coverPaths?: string[]
  existingBookFileNames?: Iterable<string>
}) {
  const existingNames = new Set(
    Array.from(input.existingBookFileNames ?? [], (value) => path.basename(value).toLocaleLowerCase()),
  )
  const coversByStem = new Map<string, string[]>()
  for (const coverPath of input.coverPaths ?? []) {
    const coverFileName = path.basename(coverPath)
    if (!isSupportedBookCover(coverFileName)) continue
    const stem = normalizeBookImportStem(coverFileName)
    const matches = coversByStem.get(stem) ?? []
    matches.push(coverPath)
    coversByStem.set(stem, matches)
  }

  const seenFileNames = new Set<string>()
  const items: BatchImportItem[] = []
  for (const sourcePath of input.bookPaths) {
    const fileName = path.basename(sourcePath)
    if (!isSupportedBookFile(fileName)) continue
    const normalizedFileName = fileName.toLocaleLowerCase()
    const coverMatches = coversByStem.get(normalizeBookImportStem(fileName)) ?? []
    const duplicateReason = existingNames.has(normalizedFileName)
      ? 'existing-book'
      : seenFileNames.has(normalizedFileName)
        ? 'duplicate-in-queue'
        : undefined
    seenFileNames.add(normalizedFileName)
    const extension = path.extname(fileName)
    items.push({
      id: crypto.randomUUID(),
      sourcePath,
      fileName,
      title: path.basename(fileName, extension),
      format: extension.slice(1).toUpperCase(),
      coverSourcePath: coverMatches.length === 1 ? coverMatches[0] : undefined,
      coverFileName: coverMatches.length === 1 ? path.basename(coverMatches[0]) : undefined,
      coverConflict: coverMatches.length > 1,
      duplicateReason,
    })
  }
  return items
}

function getBookRelativePath(fileName: string) {
  return `/books/${fileName}`
}

function toFilesystemPath(filesRoot: string, relativePath: string) {
  return path.join(filesRoot, relativePath.replace(/^[/\\]+/, ''))
}

function getExistingBookFileNames(db: Database.Database) {
  return new Set(
    (db.prepare('SELECT path FROM books').all() as Array<{ path: string | null }>)
      .map((book) => (book.path ? path.basename(book.path).toLocaleLowerCase() : ''))
      .filter(Boolean),
  )
}

export async function importBookBatch(input: {
  db: Database.Database
  filesRoot: string
  category: string
  unknownAuthor: string
  items: BatchImportItem[]
}) {
  const category = ['待读', 'To Read'].includes(input.category.trim()) ? '未分类' : input.category
  const existingNames = getExistingBookFileNames(input.db)
  const results: BatchImportItemResult[] = []
  const booksDir = path.join(input.filesRoot, 'books')
  const coversDir = path.join(input.filesRoot, 'book-covers')
  await fs.promises.mkdir(booksDir, { recursive: true })
  await fs.promises.mkdir(coversDir, { recursive: true })

  for (const item of input.items) {
    const resultBase = {
      id: item.id,
      fileName: item.fileName,
      title: item.title,
      format: item.format,
      coverFileName: item.coverFileName,
      coverConflict: item.coverConflict,
      duplicateReason: item.duplicateReason,
    }
    if (item.duplicateReason) {
      results.push({ ...resultBase, status: 'skipped' })
      continue
    }

    const normalizedFileName = item.fileName.toLocaleLowerCase()
    const bookRelativePath = getBookRelativePath(item.fileName)
    const bookTargetPath = toFilesystemPath(input.filesRoot, bookRelativePath)
    if (existingNames.has(normalizedFileName) || fs.existsSync(bookTargetPath)) {
      results.push({ ...resultBase, status: 'skipped', duplicateReason: 'existing-book' })
      continue
    }

    let copiedBook = false
    let copiedCoverPath: string | undefined
    let coverRelativePath: string | null = null
    let coverWarning: string | undefined
    try {
      await fs.promises.copyFile(item.sourcePath, bookTargetPath)
      copiedBook = true

      if (item.coverSourcePath || item.format === 'EPUB' || item.format === 'PDF') {
        try {
          coverRelativePath = await createManagedBookCover({
            sourcePath: item.sourcePath,
            format: item.format,
            filesRoot: input.filesRoot,
            coverSourcePath: item.coverSourcePath,
          })
          copiedCoverPath = coverRelativePath
            ? toFilesystemPath(input.filesRoot, coverRelativePath)
            : undefined
        } catch (error) {
          coverWarning = error instanceof Error ? error.message : 'Cover copy failed'
          if (copiedCoverPath) await fs.promises.rm(copiedCoverPath, { force: true }).catch(() => undefined)
          copiedCoverPath = undefined
        }
      }

      input.db
        .prepare(
          `INSERT INTO books (title, author, path, cover, cover_path, category, progress, status)
           VALUES (?, ?, ?, ?, ?, ?, 0.0, 'want')`,
        )
        .run(item.title, input.unknownAuthor, bookRelativePath, item.format, coverRelativePath, category)
      existingNames.add(normalizedFileName)
      results.push({ ...resultBase, status: 'success', coverWarning })
    } catch (error) {
      if (copiedBook) await fs.promises.rm(bookTargetPath, { force: true }).catch(() => undefined)
      if (copiedCoverPath) await fs.promises.rm(copiedCoverPath, { force: true }).catch(() => undefined)
      results.push({
        ...resultBase,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Import failed',
      })
    }
  }

  return results
}
