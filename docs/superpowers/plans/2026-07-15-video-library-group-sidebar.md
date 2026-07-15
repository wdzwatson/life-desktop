# Video Library Group Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the video library's crowded flat group controls with an accessible, collapsible, multilingual tree sidebar that preserves nested groups and performs group mutations atomically.

**Architecture:** Add a shared dynamic locale registry, migrate the video group schema to sibling-scoped names plus a translation table, and isolate tree/name/SQL behavior in tested utilities. A new `VideoGroupSidebar` owns presentation and transient interaction state while `Videos.tsx` remains the data owner and supplies transactional mutation callbacks.

**Tech Stack:** React 19, TypeScript 6, i18next, Vite `import.meta.glob`, Electron IPC, better-sqlite3, Node test runner, CSS.

---

## File Structure

- Create `src/localeRegistryUtils.ts`: pure locale discovery and display-name helpers that can run under Node tests.
- Create `src/localeRegistry.ts`: Vite-backed locale resource discovery and shared configured-locale API.
- Modify `src/i18n.ts`: initialize i18next from the shared resource registry.
- Modify `src/views/Settings.tsx`: render language choices from configured locales.
- Modify `src/views/Books.tsx`: remove the hardcoded book translation locale list.
- Create `tests/localeRegistry.test.ts`: verify third-language discovery and labels.
- Create `electron/db/videoGroupSchema.ts`: own video-group table migration and translation-table setup.
- Modify `electron/db/schema.ts`: invoke the focused video-group schema initializer.
- Modify `tests/videoSchema.test.mjs`: verify migration compatibility and sibling-scoped uniqueness.
- Modify `tests/dbTransaction.test.mjs`: verify atomic video-group deletion behavior.
- Create `src/views/videoGroupSidebarUtils.ts`: tree, translation, uniqueness, counting, menu, and SQL statement helpers.
- Create `tests/videoGroupSidebarUtils.test.ts`: cover pure sidebar and transaction-plan behavior.
- Modify `src/views/videoTypes.ts`: add translation/tree types and export the tag type used by the sidebar.
- Modify `src/views/videoLibraryUtils.ts`: treat invalid group references as “To Organize” and keep translated paths compatible with detail pickers.
- Modify `tests/videoLibraryUtils.test.ts`: cover invalid-group filtering and translated paths.
- Create `src/views/VideoGroupSidebar.tsx`: render fixed entries, tree rows, inline editors, context menu, translation dialog, delete dialog, and tags.
- Create `src/views/VideoGroupSidebar.css`: define stable sidebar, tree, menu, editor, and dialog styling.
- Modify `src/views/Videos.tsx`: load translations, integrate the sidebar, and implement atomic mutations.
- Modify `src/locales/zh-CN.json`: add the Chinese video-sidebar and validation copy.
- Modify `src/locales/en-US.json`: add the English fallback copy.

## Task 1: Add a Dynamic Shared Locale Registry

**Files:**
- Create: `tests/localeRegistry.test.ts`
- Create: `src/localeRegistryUtils.ts`
- Create: `src/localeRegistry.ts`
- Modify: `src/i18n.ts`
- Modify: `src/views/Settings.tsx`
- Modify: `src/views/Books.tsx`

- [ ] **Step 1: Write the failing locale-registry tests**

Create `tests/localeRegistry.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLocaleResources,
  getConfiguredLocaleOptions,
} from '../src/localeRegistryUtils.ts'

test('buildLocaleResources discovers every locale JSON module from its filename', () => {
  const resources = buildLocaleResources({
    '/src/locales/zh-CN.json': { default: { common: { confirm: '确认' } } },
    '/src/locales/en-US.json': { default: { common: { confirm: 'Confirm' } } },
    '/src/locales/ja-JP.json': { default: { common: { confirm: '確認' } } },
  })

  assert.deepEqual(Object.keys(resources), ['en-US', 'ja-JP', 'zh-CN'])
  assert.deepEqual(resources['ja-JP'].translation, { common: { confirm: '確認' } })
})

test('getConfiguredLocaleOptions exposes a newly registered language without component changes', () => {
  const options = getConfiguredLocaleOptions(
    {
      'en-US': { translation: {} },
      'ja-JP': { translation: {} },
      'zh-CN': { translation: {} },
    },
    'en-US',
  )

  assert.deepEqual(options.map((option) => option.code), ['en-US', 'ja-JP', 'zh-CN'])
  assert.match(options.find((option) => option.code === 'ja-JP')?.label || '', /Japanese|ja-JP/i)
})
```

- [ ] **Step 2: Run the locale test and verify RED**

Run:

```bash
npx tsx --test tests/localeRegistry.test.ts
```

Expected: FAIL because `src/localeRegistryUtils.ts` does not exist.

- [ ] **Step 3: Implement the pure registry helpers**

Create `src/localeRegistryUtils.ts`:

```ts
export type TranslationResource = Record<string, unknown>

export type I18nResourceMap = Record<
  string,
  {
    translation: TranslationResource
  }
>

export type LocaleModule =
  | TranslationResource
  | {
      default: TranslationResource
    }

export interface ConfiguredLocaleOption {
  code: string
  label: string
}

export function buildLocaleResources(modules: Record<string, LocaleModule>): I18nResourceMap {
  return Object.fromEntries(
    Object.entries(modules)
      .map(([filePath, module]) => {
        const locale = filePath.match(/\/([^/]+)\.json$/)?.[1]
        if (!locale) return null
        const translation = 'default' in module ? module.default : module
        return [locale, { translation }] as const
      })
      .filter((entry): entry is readonly [string, { translation: TranslationResource }] => Boolean(entry))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function getConfiguredLocaleOptions(
  resources: I18nResourceMap,
  displayLocale: string,
): ConfiguredLocaleOption[] {
  let displayNames: Intl.DisplayNames | null = null
  try {
    displayNames = new Intl.DisplayNames([displayLocale], { type: 'language' })
  } catch {
    displayNames = null
  }

  return Object.keys(resources)
    .sort((left, right) => left.localeCompare(right))
    .map((code) => ({
      code,
      label: displayNames?.of(code) || code,
    }))
}
```

- [ ] **Step 4: Verify the pure registry tests are GREEN**

Run:

```bash
npx tsx --test tests/localeRegistry.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Wire Vite locale discovery into i18next**

Create `src/localeRegistry.ts`:

```ts
import {
  buildLocaleResources,
  getConfiguredLocaleOptions,
  type LocaleModule,
} from './localeRegistryUtils'

const localeModules = import.meta.glob<LocaleModule>('./locales/*.json', {
  eager: true,
})

export const localeResources = buildLocaleResources(localeModules)

export function getConfiguredLocales(displayLocale: string) {
  return getConfiguredLocaleOptions(localeResources, displayLocale)
}
```

Replace the hardcoded imports and `resources` object in `src/i18n.ts` with:

```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { localeResources } from './localeRegistry'

i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'en-US',
  resources: localeResources,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})

export default i18n
```

- [ ] **Step 6: Replace hardcoded locale lists in Settings and Books**

In `src/views/Settings.tsx`, import `getConfiguredLocales`, obtain `i18n` from `useTranslation`, and replace the two language buttons with:

```tsx
const configuredLocales = useMemo(
  () => getConfiguredLocales(i18n.language),
  [i18n.language],
)

<div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
  {configuredLocales.map((locale) => (
    <button
      key={locale.code}
      className={`btn ${language === locale.code ? 'primary' : ''}`}
      onClick={() => setLanguage(locale.code)}
    >
      {locale.label}
    </button>
  ))}
</div>
```

In `src/views/Books.tsx`, delete `SUPPORTED_LOCALES`, import `getConfiguredLocales`, and define:

```ts
const configuredLocales = useMemo(
  () => getConfiguredLocales(i18n.language),
  [i18n.language],
)
```

Replace every `SUPPORTED_LOCALES` iteration with `configuredLocales` while preserving the existing translation fallback and transaction behavior.

- [ ] **Step 7: Run focused tests, lint, and build**

Run:

```bash
npx tsx --test tests/localeRegistry.test.ts
npm run lint
npm run build
```

Expected: locale tests pass; lint and build exit 0.

- [ ] **Step 8: Commit the locale registry**

```bash
git add src/localeRegistryUtils.ts src/localeRegistry.ts src/i18n.ts src/views/Settings.tsx src/views/Books.tsx tests/localeRegistry.test.ts
git commit -m "refactor: discover configured locales dynamically"
```

## Task 2: Migrate the Video Group Schema

**Files:**
- Create: `electron/db/videoGroupSchema.ts`
- Modify: `electron/db/schema.ts`
- Modify: `tests/videoSchema.test.mjs`

- [ ] **Step 1: Extend the schema test with translation and migration expectations**

Add these assertions to `tests/videoSchema.test.mjs` after opening `videos.db`:

```js
assert.ok(tableNames.includes('video_group_translations'))

const translationColumns = db
  .prepare('PRAGMA table_info(video_group_translations)')
  .all()
  .map((column) => column.name)
assert.deepEqual(translationColumns, ['group_id', 'locale', 'translation'])

db.prepare('INSERT INTO video_groups (name, parent_id) VALUES (?, NULL)').run('Courses')
const parentId = Number(db.prepare('SELECT id FROM video_groups WHERE name = ?').get('Courses').id)
db.prepare('INSERT INTO video_groups (name, parent_id) VALUES (?, ?)').run('AI', parentId)
db.prepare('INSERT INTO video_groups (name, parent_id) VALUES (?, NULL)').run('AI')

assert.throws(
  () => db.prepare('INSERT INTO video_groups (name, parent_id) VALUES (?, ?)').run(' ai ', parentId),
  /UNIQUE constraint failed/,
)
```

Add a second test that creates a legacy `videos.db` before initialization:

```js
test('video group migration preserves ids, hierarchy, and video assignments', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-group-migration-'))
  const legacy = new Database(path.join(dir, 'videos.db'))
  legacy.exec(`
    CREATE TABLE video_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      group_id INTEGER,
      status TEXT DEFAULT 'not_downloaded'
    );
  `)
  legacy.prepare('INSERT INTO video_groups (id, name, parent_id) VALUES (1, ?, NULL)').run('Courses')
  legacy.prepare('INSERT INTO video_groups (id, name, parent_id) VALUES (2, ?, 1)').run('AI')
  legacy.prepare('INSERT INTO videos (id, title, group_id) VALUES (1, ?, 2)').run('Lesson')
  legacy.close()

  initializeUserDatabase(dir)

  const migrated = new Database(path.join(dir, 'videos.db'))
  assert.deepEqual(migrated.prepare('SELECT id, name, parent_id FROM video_groups ORDER BY id').all(), [
    { id: 1, name: 'Courses', parent_id: null },
    { id: 2, name: 'AI', parent_id: 1 },
  ])
  assert.equal(migrated.prepare('SELECT group_id FROM videos WHERE id = 1').get().group_id, 2)
  migrated.close()
})
```

- [ ] **Step 2: Run the Electron schema test and verify RED**

Run:

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --import tsx --test tests/videoSchema.test.mjs
```

Expected: FAIL because the translation table and sibling-scoped uniqueness do not exist.

- [ ] **Step 3: Implement the focused schema initializer**

Create `electron/db/videoGroupSchema.ts` with these exported operations:

```ts
import type Database from 'better-sqlite3'

type IndexRow = { name: string; unique: number; origin: string }
type IndexColumnRow = { name: string | null }

function hasLegacyGlobalNameConstraint(db: Database.Database) {
  return (db.prepare("PRAGMA index_list('video_groups')").all() as IndexRow[]).some((index) => {
    if (!index.unique) return false
    const columns = db.prepare(`PRAGMA index_info('${index.name}')`).all() as IndexColumnRow[]
    return columns.length === 1 && columns[0].name === 'name'
  })
}

function rebuildVideoGroups(db: Database.Database) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE video_groups_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES video_groups_next(id) ON DELETE SET NULL
      );
      INSERT INTO video_groups_next (id, name, parent_id, sort_order, created_at, updated_at)
      SELECT id, name, parent_id, sort_order, created_at, updated_at FROM video_groups;
      DROP TABLE video_groups;
      ALTER TABLE video_groups_next RENAME TO video_groups;
    `)
  })()
}

export function ensureVideoGroupSchema(db: Database.Database) {
  db.pragma('foreign_keys = OFF')
  if (hasLegacyGlobalNameConstraint(db)) rebuildVideoGroups(db)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS video_groups_sibling_name_unique
    ON video_groups (COALESCE(parent_id, -1), LOWER(TRIM(name)));

    CREATE TABLE IF NOT EXISTS video_group_translations (
      group_id INTEGER NOT NULL,
      locale TEXT NOT NULL,
      translation TEXT NOT NULL,
      PRIMARY KEY (group_id, locale),
      FOREIGN KEY (group_id) REFERENCES video_groups(id) ON DELETE CASCADE
    );
  `)
  db.pragma('foreign_keys = ON')
}
```

In `electron/db/schema.ts`, import `ensureVideoGroupSchema`, keep creation of a non-unique `video_groups` table for new installs, remove the old one-column migration block, and call:

```ts
ensureVideoGroupSchema(videosDb)
```

immediately after the video group/tag/batch table creation.

- [ ] **Step 4: Run the schema test and verify GREEN**

Run:

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --import tsx --test tests/videoSchema.test.mjs
```

Expected: both schema tests pass.

- [ ] **Step 5: Commit the schema migration**

```bash
git add electron/db/videoGroupSchema.ts electron/db/schema.ts tests/videoSchema.test.mjs
git commit -m "feat: add multilingual video group schema"
```

## Task 3: Implement Tested Tree, Translation, and Mutation Utilities

**Files:**
- Create: `tests/videoGroupSidebarUtils.test.ts`
- Create: `src/views/videoGroupSidebarUtils.ts`
- Modify: `src/views/videoTypes.ts`

- [ ] **Step 1: Write failing tests for translation fallback and safe tree construction**

Create `tests/videoGroupSidebarUtils.test.ts` with:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildVideoGroupTree,
  flattenVisibleVideoGroupTree,
  getVideoGroupDisplayName,
  getVideoGroupAncestorIds,
} from '../src/views/videoGroupSidebarUtils.ts'

const groups = [
  { id: 1, name: 'Courses', parent_id: null, sort_order: 1 },
  { id: 2, name: 'AI', parent_id: 1, sort_order: 1 },
  { id: 3, name: 'Agents', parent_id: 2, sort_order: 1 },
]

const translations = [
  { group_id: 1, locale: 'zh-CN', translation: '课程' },
  { group_id: 2, locale: 'zh-CN', translation: '人工智能' },
]

test('video group display names use current translation then canonical fallback', () => {
  assert.equal(getVideoGroupDisplayName(groups[0], translations, 'zh-CN'), '课程')
  assert.equal(getVideoGroupDisplayName(groups[2], translations, 'zh-CN'), 'Agents')
})

test('tree flattening respects expansion while keeping translated paths', () => {
  const tree = buildVideoGroupTree(groups, translations, 'zh-CN')
  assert.deepEqual(
    flattenVisibleVideoGroupTree(tree, new Set([1, 2])).map(({ id, depth, path }) => ({ id, depth, path })),
    [
      { id: 1, depth: 0, path: '课程' },
      { id: 2, depth: 1, path: '课程 / 人工智能' },
      { id: 3, depth: 2, path: '课程 / 人工智能 / Agents' },
    ],
  )
  assert.deepEqual(getVideoGroupAncestorIds(groups, 3), [1, 2])
})

test('tree construction surfaces orphaned and cyclic groups exactly once', () => {
  const malformed = [
    { id: 1, name: 'A', parent_id: 2 },
    { id: 2, name: 'B', parent_id: 1 },
    { id: 3, name: 'Orphan', parent_id: 99 },
  ]
  const rows = flattenVisibleVideoGroupTree(
    buildVideoGroupTree(malformed, [], 'en-US'),
    new Set([1, 2, 3]),
  )
  assert.deepEqual(rows.map((row) => row.id).sort((a, b) => a - b), [1, 2, 3])
})
```

- [ ] **Step 2: Add failing tests for counts, conflicts, menu movement, and SQL plans**

Append:

```ts
import {
  buildCreateVideoGroupStatements,
  buildDeleteVideoGroupStatements,
  buildUpdateVideoGroupTranslationsStatements,
  findSiblingVideoGroupNameConflict,
  getContextMenuPosition,
  getDirectVideoGroupCounts,
  getNextMenuFocusIndex,
  getVideoGroupDeleteImpact,
  getVideoGroupIdAfterDelete,
} from '../src/views/videoGroupSidebarUtils.ts'

test('counts separate direct videos from child groups', () => {
  const videos = [
    { id: 1, group_id: 1 },
    { id: 2, group_id: 1 },
    { id: 3, group_id: 2 },
  ]
  assert.deepEqual(getDirectVideoGroupCounts(videos), new Map([[1, 2], [2, 1]]))
  assert.deepEqual(getVideoGroupDeleteImpact(groups, videos, 1), {
    directVideoCount: 2,
    directChildCount: 1,
  })
})

test('name conflicts are scoped to siblings and locale display names', () => {
  assert.equal(
    findSiblingVideoGroupNameConflict({
      groups,
      translations,
      parentId: 1,
      locale: 'zh-CN',
      name: ' 人工智能 ',
    })?.id,
    2,
  )
  assert.equal(
    findSiblingVideoGroupNameConflict({
      groups,
      translations,
      parentId: null,
      locale: 'zh-CN',
      name: '人工智能',
    }),
    null,
  )
})

test('mutation statement builders preserve current locale and promote children on delete', () => {
  assert.equal(buildCreateVideoGroupStatements('AI', 1, 'en-US', 4).length, 2)
  assert.deepEqual(buildUpdateVideoGroupTranslationsStatements(2, {
    'en-US': 'AI',
    'ja-JP': '',
  }).map((statement) => statement.sql.trim().split(/\s+/).slice(0, 3).join(' ')), [
    'INSERT OR REPLACE INTO',
    'DELETE FROM video_group_translations',
  ])
  assert.equal(buildDeleteVideoGroupStatements(2, 1).length, 4)
  assert.equal(getVideoGroupIdAfterDelete(2, 2), 'all')
  assert.equal(getVideoGroupIdAfterDelete(1, 2), 1)
})

test('menu helpers clamp position and wrap keyboard focus', () => {
  assert.deepEqual(getContextMenuPosition({
    clientX: 795,
    clientY: 595,
    viewportWidth: 800,
    viewportHeight: 600,
    menuWidth: 196,
    menuHeight: 166,
  }), { left: 596, top: 426 })
  assert.equal(getNextMenuFocusIndex(0, 4, 'ArrowUp'), 3)
  assert.equal(getNextMenuFocusIndex(3, 4, 'ArrowDown'), 0)
})
```

- [ ] **Step 3: Run the utility tests and verify RED**

Run:

```bash
npx tsx --test tests/videoGroupSidebarUtils.test.ts
```

Expected: FAIL because the sidebar utilities and types do not exist.

- [ ] **Step 4: Add video group translation and tree types**

Append to `src/views/videoTypes.ts`:

```ts
export interface VideoGroupTranslation {
  group_id: number
  locale: string
  translation: string
}

export interface VideoTagRecord {
  id: number
  name: string
  color?: string
}

export interface VideoGroupTreeNode extends VideoGroupRecord {
  displayName: string
  depth: number
  path: string
  children: VideoGroupTreeNode[]
}
```

- [ ] **Step 5: Implement the pure utility module**

Create `src/views/videoGroupSidebarUtils.ts` with the tested exports. Use these exact SQL plans:

```ts
import type { DbTransactionStatement } from '../../electron/db/transaction'
import type {
  VideoGroupRecord,
  VideoGroupTranslation,
  VideoGroupTreeNode,
} from './videoTypes'

export type VideoGroupFilterId = number | null | 'all'

export function normalizeVideoGroupDisplayName(value: unknown) {
  return String(value ?? '').trim()
}

export function getVideoGroupDisplayName(
  group: VideoGroupRecord,
  translations: VideoGroupTranslation[],
  locale: string,
) {
  return normalizeVideoGroupDisplayName(
    translations.find((item) => item.group_id === group.id && item.locale === locale)?.translation,
  ) || group.name
}

export function buildCreateVideoGroupStatements(
  name: string,
  parentId: number | null,
  locale: string,
  sortOrder: number,
): DbTransactionStatement[] {
  return [
    {
      sql: 'INSERT INTO video_groups (name, parent_id, sort_order) VALUES (?, ?, ?)',
      params: [name.trim(), parentId, sortOrder],
    },
    {
      sql: `INSERT INTO video_group_translations (group_id, locale, translation)
            VALUES (last_insert_rowid(), ?, ?)`,
      params: [locale, name.trim()],
    },
  ]
}

export function buildUpdateVideoGroupTranslationsStatements(
  groupId: number,
  values: Record<string, string>,
): DbTransactionStatement[] {
  return Object.entries(values).map(([locale, rawValue]) => {
    const value = rawValue.trim()
    return value
      ? {
          sql: `INSERT OR REPLACE INTO video_group_translations
                (group_id, locale, translation) VALUES (?, ?, ?)`,
          params: [groupId, locale, value],
        }
      : {
          sql: 'DELETE FROM video_group_translations WHERE group_id = ? AND locale = ?',
          params: [groupId, locale],
        }
  })
}

export function buildDeleteVideoGroupStatements(
  groupId: number,
  parentId: number | null,
): DbTransactionStatement[] {
  return [
    { sql: 'UPDATE videos SET group_id = NULL WHERE group_id = ?', params: [groupId] },
    { sql: 'UPDATE video_groups SET parent_id = ? WHERE parent_id = ?', params: [parentId, groupId] },
    { sql: 'DELETE FROM video_group_translations WHERE group_id = ?', params: [groupId] },
    { sql: 'DELETE FROM video_groups WHERE id = ?', params: [groupId] },
  ]
}
```

Implement tree construction with a `visited` set and an active recursion set so malformed cycles are emitted once as roots. Implement comparison with `normalizeVideoGroupDisplayName(value).toLocaleLowerCase(locale)`. Implement count, impact, ancestor, flattening, selection-after-delete, menu-position, and menu-focus helpers exactly to satisfy the tests.

- [ ] **Step 6: Run the utility tests and verify GREEN**

Run:

```bash
npx tsx --test tests/videoGroupSidebarUtils.test.ts
```

Expected: all utility tests pass.

- [ ] **Step 7: Commit the utility layer**

```bash
git add src/views/videoTypes.ts src/views/videoGroupSidebarUtils.ts tests/videoGroupSidebarUtils.test.ts
git commit -m "feat: add video group tree utilities"
```

## Task 4: Correct “To Organize” Filtering and Verify Atomic Delete

**Files:**
- Modify: `src/views/videoTypes.ts`
- Modify: `src/views/videoLibraryUtils.ts`
- Modify: `tests/videoLibraryUtils.test.ts`
- Modify: `tests/dbTransaction.test.mjs`

- [ ] **Step 1: Write a failing invalid-group filter test**

Append to `tests/videoLibraryUtils.test.ts`:

```ts
test('uncategorized video filtering includes missing group references', () => {
  const records = [
    { id: 1, title: 'No group', group_id: null, status: 'not_downloaded', tags: [] },
    { id: 2, title: 'Known group', group_id: 2, status: 'not_downloaded', tags: [] },
    { id: 3, title: 'Missing group', group_id: 99, status: 'not_downloaded', tags: [] },
  ]

  assert.deepEqual(
    filterVideos(records, {
      query: '',
      groupId: null,
      validGroupIds: [2],
      tag: null,
    }).map((video) => video.id),
    [1, 3],
  )
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx tsx --test tests/videoLibraryUtils.test.ts
```

Expected: FAIL because `VideoFilter` has no `validGroupIds` behavior.

- [ ] **Step 3: Implement invalid-group filtering**

Add to `VideoFilter` in `src/views/videoTypes.ts`:

```ts
validGroupIds?: number[]
```

Replace the null-group branch in `filterVideos` with:

```ts
if (filter.groupId === null) {
  const validGroupIds = new Set(filter.validGroupIds || [])
  if (
    video.group_id != null &&
    (filter.validGroupIds === undefined || validGroupIds.has(video.group_id))
  ) {
    return false
  }
}
```

- [ ] **Step 4: Add a failing atomic delete transaction test**

Append to `tests/dbTransaction.test.mjs` using an in-memory video schema:

```js
test('video group deletion detaches direct videos, promotes children, and rolls back together', () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE video_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER);
    CREATE TABLE video_group_translations (
      group_id INTEGER NOT NULL,
      locale TEXT NOT NULL,
      translation TEXT NOT NULL,
      PRIMARY KEY (group_id, locale)
    );
    CREATE TABLE videos (id INTEGER PRIMARY KEY, title TEXT NOT NULL, group_id INTEGER);
  `)
  db.prepare('INSERT INTO video_groups VALUES (1, ?, NULL)').run('Parent')
  db.prepare('INSERT INTO video_groups VALUES (2, ?, 1)').run('Target')
  db.prepare('INSERT INTO video_groups VALUES (3, ?, 2)').run('Child')
  db.prepare('INSERT INTO videos VALUES (1, ?, 2)').run('Direct')
  db.prepare('INSERT INTO video_group_translations VALUES (2, ?, ?)').run('en-US', 'Target')

  runDbTransaction(db, buildDeleteVideoGroupStatements(2, 1))

  assert.equal(db.prepare('SELECT group_id FROM videos WHERE id = 1').get().group_id, null)
  assert.equal(db.prepare('SELECT parent_id FROM video_groups WHERE id = 3').get().parent_id, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_groups WHERE id = 2').get().count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_group_translations WHERE group_id = 2').get().count, 0)
  db.close()
})
```

Import `buildDeleteVideoGroupStatements` from `src/views/videoGroupSidebarUtils.ts`.

- [ ] **Step 5: Run focused and Electron transaction tests**

Run:

```bash
npx tsx --test tests/videoLibraryUtils.test.ts
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --import tsx --test tests/dbTransaction.test.mjs
```

Expected: both suites pass.

- [ ] **Step 6: Commit filtering and transaction coverage**

```bash
git add src/views/videoTypes.ts src/views/videoLibraryUtils.ts tests/videoLibraryUtils.test.ts tests/dbTransaction.test.mjs
git commit -m "fix: classify ungrouped videos safely"
```

## Task 5: Build the Accessible Tree Sidebar Component

**Files:**
- Create: `src/views/VideoGroupSidebar.tsx`
- Create: `src/views/VideoGroupSidebar.css`
- Modify: `src/views/videoGroupSidebarUtils.ts`
- Modify: `tests/videoGroupSidebarUtils.test.ts`

- [ ] **Step 1: Add failing state-helper tests for expansion and menu focus**

Append to `tests/videoGroupSidebarUtils.test.ts`:

```ts
import {
  expandVideoGroupWithAncestors,
  toggleExpandedVideoGroup,
} from '../src/views/videoGroupSidebarUtils.ts'

test('group expansion toggles one node and expands selected ancestors', () => {
  assert.deepEqual([...toggleExpandedVideoGroup(new Set([1]), 1)], [])
  assert.deepEqual([...toggleExpandedVideoGroup(new Set(), 1)], [1])
  assert.deepEqual([...expandVideoGroupWithAncestors(new Set(), groups, 3)], [1, 2])
})
```

- [ ] **Step 2: Run the state-helper test and verify RED**

Run:

```bash
npx tsx --test tests/videoGroupSidebarUtils.test.ts
```

Expected: FAIL because the expansion helpers are missing.

- [ ] **Step 3: Implement expansion helpers and verify GREEN**

Add:

```ts
export function toggleExpandedVideoGroup(current: Set<number>, groupId: number) {
  const next = new Set(current)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  return next
}

export function expandVideoGroupWithAncestors(
  current: Set<number>,
  groups: VideoGroupRecord[],
  groupId: number,
) {
  return new Set([...current, ...getVideoGroupAncestorIds(groups, groupId)])
}
```

Run:

```bash
npx tsx --test tests/videoGroupSidebarUtils.test.ts
```

Expected: all sidebar utility tests pass.

- [ ] **Step 4: Create the sidebar component contract**

Create `src/views/VideoGroupSidebar.tsx` with this public contract:

```ts
import type {
  VideoGroupRecord,
  VideoGroupTranslation,
  VideoRecord,
  VideoTagRecord,
} from './videoTypes'

export type VideoGroupMutationResult =
  | { ok: true; groupId?: number }
  | { ok: false; error: string }

type VideoGroupSidebarProps = {
  groups: VideoGroupRecord[]
  translations: VideoGroupTranslation[]
  videos: Pick<VideoRecord, 'id' | 'group_id'>[]
  tags: VideoTagRecord[]
  activeGroupId: number | null | 'all'
  activeTag: string | null
  locale: string
  onSelectGroup: (groupId: number | null | 'all') => void
  onSelectTag: (tag: string | null) => void
  onCreateGroup: (parentId: number | null, name: string) => Promise<VideoGroupMutationResult>
  onRenameGroup: (group: VideoGroupRecord, name: string) => Promise<VideoGroupMutationResult>
  onSaveTranslations: (
    group: VideoGroupRecord,
    values: Record<string, string>,
  ) => Promise<VideoGroupMutationResult>
  onDeleteGroup: (group: VideoGroupRecord) => Promise<VideoGroupMutationResult>
}
```

The component must:

- initialize `expandedGroupIds` with all top-level groups;
- expand ancestors when a numeric `activeGroupId` changes;
- render fixed `all` and `null` rows with counts;
- render only rows returned by `flattenVisibleVideoGroupTree`;
- stop propagation on chevron clicks;
- use the title `+` for a top-level inline editor only;
- open a four-item context menu on `contextmenu` without selecting the row;
- insert a child editor immediately below its parent and expand the parent;
- use `AccessibleDialog` for translation and delete confirmation;
- preserve input and show inline error when a callback returns `{ ok: false }`;
- restore menu/dialog focus to the originating row;
- support ArrowUp, ArrowDown, Enter, Tab, and Escape in the menu.

- [ ] **Step 5: Add stable CSS without inline layout churn**

Create `src/views/VideoGroupSidebar.css` with component-scoped selectors for:

```css
.video-group-sidebar
.video-group-sidebar__content
.video-group-sidebar__fixed-list
.video-group-sidebar__section-title
.video-group-sidebar__add-button
.video-group-sidebar__tree
.video-group-sidebar__row
.video-group-sidebar__row.active
.video-group-sidebar__row.context-open
.video-group-sidebar__chevron
.video-group-sidebar__chevron-spacer
.video-group-sidebar__label
.video-group-sidebar__count
.video-group-sidebar__editor
.video-group-sidebar__error
.video-group-sidebar__context-menu
.video-group-sidebar__menu-separator
.video-group-sidebar__tags
.video-group-sidebar__tag
.video-group-sidebar__dialog-form
.video-group-sidebar__dialog-actions
```

Use a 38px row height, an 18px chevron/icon column, a flexible label column, and a fixed count pill. Derive hover, active, warning, border, and focus colors from existing theme variables and `color-mix`, matching `BookCategorySidebar.css`.

- [ ] **Step 6: Run lint and build for the component**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the sidebar component**

```bash
git add src/views/VideoGroupSidebar.tsx src/views/VideoGroupSidebar.css src/views/videoGroupSidebarUtils.ts tests/videoGroupSidebarUtils.test.ts
git commit -m "feat: add hierarchical video group sidebar"
```

## Task 6: Integrate Translated Reads and Tree Filtering into Videos

**Files:**
- Modify: `src/views/Videos.tsx`
- Modify: `src/views/videoGroupSidebarUtils.ts`
- Modify: `tests/videoGroupSidebarUtils.test.ts`

- [ ] **Step 1: Write a failing localized-group projection test**

Append to `tests/videoGroupSidebarUtils.test.ts`:

```ts
import { localizeVideoGroups } from '../src/views/videoGroupSidebarUtils.ts'

test('localizeVideoGroups projects current display names without mutating canonical groups', () => {
  const localized = localizeVideoGroups(groups, translations, 'zh-CN')
  assert.deepEqual(
    localized.map(({ id, name }) => ({ id, name })),
    [
      { id: 1, name: '课程' },
      { id: 2, name: '人工智能' },
      { id: 3, name: 'Agents' },
    ],
  )
  assert.equal(groups[0].name, 'Courses')
})
```

Run:

```bash
npx tsx --test tests/videoGroupSidebarUtils.test.ts
```

Expected: FAIL because `localizeVideoGroups` is missing.

- [ ] **Step 2: Implement the localized projection and verify GREEN**

Add to `src/views/videoGroupSidebarUtils.ts`:

```ts
export function localizeVideoGroups(
  groups: VideoGroupRecord[],
  translations: VideoGroupTranslation[],
  locale: string,
) {
  return groups.map((group) => ({
    ...group,
    name: getVideoGroupDisplayName(group, translations, locale),
  }))
}
```

Run:

```bash
npx tsx --test tests/videoGroupSidebarUtils.test.ts
```

Expected: all sidebar utility tests pass.

- [ ] **Step 3: Load translations and derive localized groups**

In `src/views/Videos.tsx`:

```ts
const [groupTranslations, setGroupTranslations] = useState<VideoGroupTranslation[]>([])

const translationsRes = await api.dbQuery(
  'videos',
  'SELECT group_id, locale, translation FROM video_group_translations',
)
if (translationsRes?.success) setGroupTranslations(translationsRes.data)

const localizedGroups = useMemo(
  () => localizeVideoGroups(groups, groupTranslations, i18n.language),
  [groups, groupTranslations, i18n.language],
)

const groupOptions = useMemo(() => getVideoGroupOptions(localizedGroups), [localizedGroups])
```

Keep canonical `groups` for mutations and parent relationships. Use `localizedGroups` only for display paths in dropdowns and labels.

- [ ] **Step 4: Pass valid group IDs into filtering**

Add:

```ts
const validGroupIds = useMemo(() => groups.map((group) => group.id), [groups])
```

and pass it into `getVideoLibraryVideos`:

```ts
getVideoLibraryVideos(localVideos, {
  query: searchQuery,
  groupId: activeGroupId,
  groupIds: selectedGroupIds,
  validGroupIds,
  tag: activeTag,
})
```

- [ ] **Step 5: Replace the inline left sidebar with `VideoGroupSidebar`**

Import `VideoGroupSidebar` and its CSS-backed component. Replace the existing `<aside className="card">...</aside>` block with:

```tsx
<VideoGroupSidebar
  groups={groups}
  translations={groupTranslations}
  videos={localVideos}
  tags={tags}
  activeGroupId={activeGroupId}
  activeTag={activeTag}
  locale={i18n.language}
  onSelectGroup={setActiveGroupId}
  onSelectTag={setActiveTag}
  onCreateGroup={handleCreateGroup}
  onRenameGroup={handleRenameGroup}
  onSaveTranslations={handleSaveGroupTranslations}
  onDeleteGroup={handleDeleteGroup}
/>
```

Remove `isCreatingGroup`, `newGroupName`, `editingGroupId`, and `editingGroupName` from `Videos.tsx`; these transient UI states now belong to the sidebar.

- [ ] **Step 6: Run video utility tests, lint, and build**

Run:

```bash
npx tsx --test tests/videoLibraryUtils.test.ts tests/videoGroupSidebarUtils.test.ts
npm run lint
npm run build
```

Expected: tests pass; lint and build exit 0.

- [ ] **Step 7: Commit read-path integration**

```bash
git add src/views/Videos.tsx src/views/videoGroupSidebarUtils.ts tests/videoGroupSidebarUtils.test.ts
git commit -m "refactor: integrate video group tree sidebar"
```

## Task 7: Implement Atomic Group Mutations and Multilingual Dialogs

**Files:**
- Modify: `src/views/Videos.tsx`
- Modify: `src/views/VideoGroupSidebar.tsx`
- Modify: `src/views/videoGroupSidebarUtils.ts`
- Modify: `tests/videoGroupSidebarUtils.test.ts`

- [ ] **Step 1: Write failing SQL-plan tests for rename and full translation editing**

Append to `tests/videoGroupSidebarUtils.test.ts`:

```ts
import { buildRenameVideoGroupStatements } from '../src/views/videoGroupSidebarUtils.ts'

test('rename updates canonical name and current locale in one plan', () => {
  assert.deepEqual(buildRenameVideoGroupStatements(2, 'Agents', 'en-US'), [
    {
      sql: 'UPDATE video_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      params: ['Agents', 2],
    },
    {
      sql: `INSERT OR REPLACE INTO video_group_translations
            (group_id, locale, translation) VALUES (?, ?, ?)`,
      params: [2, 'en-US', 'Agents'],
    },
  ])
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx tsx --test tests/videoGroupSidebarUtils.test.ts
```

Expected: FAIL because `buildRenameVideoGroupStatements` is missing.

- [ ] **Step 3: Implement the rename plan and validate all writes before IPC**

Add:

```ts
export function buildRenameVideoGroupStatements(
  groupId: number,
  name: string,
  locale: string,
): DbTransactionStatement[] {
  const normalized = name.trim()
  return [
    {
      sql: 'UPDATE video_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      params: [normalized, groupId],
    },
    {
      sql: `INSERT OR REPLACE INTO video_group_translations
            (group_id, locale, translation) VALUES (?, ?, ?)`,
      params: [groupId, locale, normalized],
    },
  ]
}
```

In each `Videos.tsx` mutation callback, call `findSiblingVideoGroupNameConflict` before `dbTransaction`. Return a localized `{ ok: false, error }` instead of closing UI state when validation fails.

- [ ] **Step 4: Implement transactional create**

Replace the old create handler with:

```ts
const handleCreateGroup = async (parentId: number | null, rawName: string) => {
  if (!api?.dbTransaction) {
    return { ok: false as const, error: t('videos.toast_group_save_failed') }
  }
  const name = normalizeVideoGroupDisplayName(rawName)
  if (!name) return { ok: false as const, error: t('videos.group_name_required') }
  const conflict = findSiblingVideoGroupNameConflict({
    groups,
    translations: groupTranslations,
    parentId,
    locale: i18n.language,
    name,
  })
  if (conflict) return { ok: false as const, error: t('videos.group_name_duplicate') }

  const result = await api.dbTransaction(
    'videos',
    buildCreateVideoGroupStatements(name, parentId, i18n.language, groups.length + 1),
  )
  if (!result?.success) {
    await loadData()
    return { ok: false as const, error: result?.error || t('videos.toast_group_save_failed') }
  }
  const groupId = Number(result.data?.[0]?.lastInsertRowid)
  await loadData()
  setActiveGroupId(groupId)
  showToast(t('videos.toast_group_created'))
  return { ok: true as const, groupId }
}
```

- [ ] **Step 5: Implement transactional rename and translation save**

Implement `handleRenameGroup(group, name)` with `buildRenameVideoGroupStatements`. Implement `handleSaveGroupTranslations(group, values)` by:

1. validating every non-empty locale value against siblings using that locale;
2. setting the canonical name from `values[i18n.language]` when non-empty, otherwise retaining `group.name`;
3. combining the canonical update with `buildUpdateVideoGroupTranslationsStatements` in one `dbTransaction`;
4. reloading data only after the transaction result is known;
5. returning `{ ok: false, error }` without closing the dialog on failure.

Use this canonical update statement at the beginning of the transaction:

```ts
{
  sql: 'UPDATE video_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  params: [nextCanonicalName, group.id],
}
```

- [ ] **Step 6: Implement transactional delete and state repair**

Implement `handleDeleteGroup(group)` with `buildDeleteVideoGroupStatements(group.id, group.parent_id ?? null)`. On success:

```ts
setActiveGroupId((current) => getVideoGroupIdAfterDelete(current, group.id))
setSelectedVideo((current: VideoRecord | null) =>
  current?.group_id === group.id
    ? { ...current, group_id: null, group_name: null }
    : current,
)
setDraftGroupId((current) => (current === group.id ? null : current))
showToast(t('videos.toast_group_deleted'))
await loadData()
return { ok: true as const }
```

On failure, reload data and return `{ ok: false, error }`; do not show a success toast.

- [ ] **Step 7: Complete translation and delete dialogs in the sidebar**

For the translation dialog:

- derive locale rows from `getConfiguredLocales(locale)`;
- initialize each value from the group's matching translation or an empty string;
- place the current locale first;
- use `t('common.more_translations')` to expand other locales;
- submit the complete `Record<string, string>` to `onSaveTranslations`.

For the delete dialog, use `getVideoGroupDeleteImpact` and render localized interpolation values:

```tsx
{t('videos.confirm_delete_group_body', {
  name: target.displayName,
  videoCount: impact.directVideoCount,
  childCount: impact.directChildCount,
})}
```

Disable the destructive confirmation button while the deletion promise is pending, focus the cancel button first, and preserve the dialog with an inline error if deletion fails.

- [ ] **Step 8: Run focused tests, lint, and build**

Run:

```bash
npx tsx --test tests/videoGroupSidebarUtils.test.ts tests/videoLibraryUtils.test.ts
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --import tsx --test tests/dbTransaction.test.mjs
npm run lint
npm run build
```

Expected: all focused tests pass; lint and build exit 0.

- [ ] **Step 9: Commit atomic mutations**

```bash
git add src/views/Videos.tsx src/views/VideoGroupSidebar.tsx src/views/videoGroupSidebarUtils.ts tests/videoGroupSidebarUtils.test.ts
git commit -m "feat: manage nested video groups atomically"
```

## Task 8: Add Localized Copy and Complete Verification

**Files:**
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`
- Modify: `src/views/VideoGroupSidebar.tsx`
- Modify: `src/views/Videos.tsx`

- [ ] **Step 1: Add all affected i18n keys in both fallback resources**

Add the following keys under `videos` in both locale files:

```json
{
  "sidebar_title": "视频分组",
  "all_videos_sidebar": "全部视频",
  "to_organize": "待整理",
  "my_groups": "我的分组",
  "add_top_level_group": "新建一级分组",
  "add_child_group": "新增子分组",
  "rename_group": "重命名",
  "edit_group_translations": "编辑其他语言名称…",
  "delete_group": "删除分组…",
  "expand_group": "展开分组“{{name}}”",
  "collapse_group": "收起分组“{{name}}”",
  "group_name_required": "请输入分组名称",
  "group_name_duplicate": "同一级中已存在这个分组名称",
  "group_translation_duplicate": "{{language}}中同一级已存在这个名称",
  "group_create_failed": "分组创建失败",
  "group_update_failed": "分组更新失败",
  "group_delete_failed": "分组删除失败",
  "confirm_delete_group_title": "删除分组",
  "confirm_delete_group_body": "删除分组“{{name}}”？其中 {{videoCount}} 个直属视频不会被删除，将移至“待整理”；{{childCount}} 个直属子分组将提升到上一级。",
  "group_unavailable": "该分组已不存在，列表已刷新",
  "translation_name_placeholder": "输入{{language}}名称"
}
```

Use equivalent English values in `en-US.json`. Keep existing keys that are still used by detail selectors and old toasts; remove a key only after `rg` confirms it has no callers.

- [ ] **Step 2: Search for hardcoded affected copy**

Run:

```bash
rg -n "全部视频|待整理|我的分组|新增子分组|编辑其他语言|删除分组|All Videos|To Organize|My Groups" src/views/Videos.tsx src/views/VideoGroupSidebar.tsx src/views/Settings.tsx src/views/Books.tsx
```

Expected: no user-facing affected copy remains outside locale resources, except test fixtures and locale display data returned by `Intl.DisplayNames`.

- [ ] **Step 3: Run the complete automated verification suite**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all tests pass with 0 failures; lint and build exit 0.

- [ ] **Step 4: Run Electron visual and interaction verification**

Start the app with the existing development command and verify:

1. fixed “All Videos” and “To Organize” rows are visually separate from “My Groups”;
2. the title `+` creates only a top-level group;
3. right-click offers child creation, rename, other-language editing, and delete;
4. chevron clicks do not select; right-click does not select; left-click filters descendants;
5. deleting a parent detaches direct videos and promotes direct children;
6. switching languages updates group labels without changing selection or expansion;
7. adding a temporary third locale fixture makes it appear automatically in Settings and translation editing;
8. menu keyboard navigation, dialog focus trap, Escape, and focus restoration work;
9. long names and deep nesting remain stable in light and dark themes.

Remove the temporary third locale fixture after verification and rerun `npm run build`.

- [ ] **Step 5: Commit localization and verification fixes**

```bash
git add src/locales/zh-CN.json src/locales/en-US.json src/views/VideoGroupSidebar.tsx src/views/Videos.tsx
git commit -m "feat: localize video group management"
```

- [ ] **Step 6: Confirm the final worktree state**

Run:

```bash
git status --short --branch
git log --oneline -8
```

Expected: the feature branch contains the planned commits and the worktree has no uncommitted files.
