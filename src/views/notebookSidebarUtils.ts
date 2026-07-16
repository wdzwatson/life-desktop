export const ALL_NOTES_SCOPE = '__all_notes__'
export const UNCATEGORIZED_NOTEBOOK = '未分类'

export type NotebookDbStatement = {
  sql: string
  params?: unknown[]
}

export type NotebookLocaleValue = {
  locale: string
  translation: string
}

export type NotebookCategoryOption = {
  storageName: string
  displayName: string
}

const normalizeCategoryAlias = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')

export function resolveNotebookCategoryStorageName(
  value: string,
  options: NotebookCategoryOption[],
) {
  const trimmedValue = value.trim()
  const normalizedValue = normalizeCategoryAlias(trimmedValue)
  const existing = options.find(
    (option) =>
      normalizeCategoryAlias(option.storageName) === normalizedValue ||
      normalizeCategoryAlias(option.displayName) === normalizedValue,
  )
  return existing?.storageName || trimmedValue
}

const translationInsertSql =
  'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES (?, ?, ?, ?)'

export function buildCreateNotebookStatements({
  name,
  category,
  nameTranslations,
  categoryTranslations,
}: {
  name: string
  category: string
  nameTranslations: NotebookLocaleValue[]
  categoryTranslations: NotebookLocaleValue[]
}): NotebookDbStatement[] {
  return [
    {
      sql: 'INSERT INTO notebooks (name, category) VALUES (?, ?)',
      params: [name, category],
    },
    ...nameTranslations.map(({ locale, translation }) => ({
      sql: `INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation)
            SELECT 'notebook', CAST(id AS TEXT), ?, ? FROM notebooks WHERE name = ?`,
      params: [locale, translation, name],
    })),
    ...(category === '默认'
      ? []
      : categoryTranslations.map(({ locale, translation }) => ({
          sql: translationInsertSql,
          params: ['notebook_category', category, locale, translation],
        }))),
  ]
}

export function buildRenameNotebookStatements({
  id,
  previousName,
  name,
  category,
  nameTranslations,
  categoryTranslations,
}: {
  id: number
  previousName: string
  name: string
  category: string
  nameTranslations: NotebookLocaleValue[]
  categoryTranslations: NotebookLocaleValue[]
}): NotebookDbStatement[] {
  return [
    {
      sql: 'UPDATE notebooks SET name = ?, category = ? WHERE id = ?',
      params: [name, category, id],
    },
    {
      sql: `UPDATE notes SET notebook = ?
            WHERE notebook = ? AND EXISTS (SELECT 1 FROM notebooks WHERE id = ?)`,
      params: [name, previousName, id],
    },
    ...nameTranslations.map(({ locale, translation }) => ({
      sql: `INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation)
            SELECT 'notebook', CAST(id AS TEXT), ?, ? FROM notebooks WHERE id = ?`,
      params: [locale, translation, id],
    })),
    ...(category === '默认'
      ? []
      : categoryTranslations.map(({ locale, translation }) => ({
          sql: `INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation)
                SELECT 'notebook_category', ?, ?, ?
                WHERE EXISTS (SELECT 1 FROM notebooks WHERE id = ?)`,
          params: [category, locale, translation, id],
        }))),
  ]
}

export function buildDeleteNotebookStatements(
  id: number,
  name: string,
): NotebookDbStatement[] {
  return [
    {
      sql: 'INSERT OR IGNORE INTO notebooks (name, category) VALUES (?, ?)',
      params: [UNCATEGORIZED_NOTEBOOK, '默认'],
    },
    {
      sql: `UPDATE notes SET notebook = ?
            WHERE notebook = ? AND EXISTS (SELECT 1 FROM notebooks WHERE id = ?)`,
      params: [UNCATEGORIZED_NOTEBOOK, name, id],
    },
    {
      sql: "DELETE FROM translations WHERE entity_type = 'notebook' AND entity_id = ?",
      params: [String(id)],
    },
    { sql: 'DELETE FROM notebooks WHERE id = ?', params: [id] },
  ]
}

export function getNotebookTransactionError(error: unknown, fallback: string) {
  return typeof error === 'string' && error.trim() ? error : fallback
}
