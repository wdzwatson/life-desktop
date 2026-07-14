# Book Library Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed book-category list with a friendly two-level sidebar: fixed “All Books / To Organize” access at the top and clean, right-click-manageable custom shelves below.

**Architecture:** Extract the sidebar into a focused React component that owns only presentation and transient interaction state. Keep database mutations, translations, book counts, and `activeCategory` in `Books.tsx`. Put menu-positioning and post-delete selection rules in pure utilities so the risky interaction logic is covered by Node tests without adding a React test framework.

**Tech Stack:** React 19, TypeScript 6, react-i18next, lucide-react, CSS, Node test runner through `tsx --test`, Electron renderer database bridge.

---

## File Structure

- Create `src/views/BookCategorySidebar.tsx` — sidebar rendering, inline create/rename state, context menu, focus management, and callback coordination.
- Create `src/views/BookCategorySidebar.css` — stable row layout and theme-aware visual states.
- Create `src/views/bookCategorySidebarUtils.ts` — reserved-name filtering, context-menu clamping, and active-selection fallback rules.
- Create `tests/bookCategorySidebarUtils.test.ts` — pure behavior tests for the sidebar utilities.
- Create `tests/bookCategoryTranslations.test.mjs` — verifies every new sidebar string exists in Chinese and English.
- Modify `src/views/Books.tsx` — integrate the component, supply counts/display names, implement create/rename/delete callbacks, and keep translation editing available.
- Modify `src/locales/zh-CN.json` — Chinese sidebar, validation, context-menu, and deletion copy.
- Modify `src/locales/en-US.json` — English equivalents of the same keys.

## Task 1: Add Tested Sidebar Utility Rules

**Files:**
- Create: `src/views/bookCategorySidebarUtils.ts`
- Create: `tests/bookCategorySidebarUtils.test.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `tests/bookCategorySidebarUtils.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getActiveCategoryAfterDelete,
  getContextMenuPosition,
  isReservedBookCategory,
} from '../src/views/bookCategorySidebarUtils.ts'

test('reserved storage aliases are excluded from custom shelves', () => {
  for (const name of ['', '未分类', 'Uncategorized', 'Category', '分类']) {
    assert.equal(isReservedBookCategory(name), true)
  }
  assert.equal(isReservedBookCategory('技术'), false)
  assert.equal(isReservedBookCategory('Design'), false)
})

test('context menu stays inside the viewport near the bottom-right edge', () => {
  assert.deepEqual(
    getContextMenuPosition({
      clientX: 790,
      clientY: 590,
      viewportWidth: 800,
      viewportHeight: 600,
      menuWidth: 176,
      menuHeight: 132,
      margin: 8,
    }),
    { left: 616, top: 460 },
  )
})

test('context menu preserves pointer position when there is enough room', () => {
  assert.deepEqual(
    getContextMenuPosition({
      clientX: 120,
      clientY: 90,
      viewportWidth: 800,
      viewportHeight: 600,
      menuWidth: 176,
      menuHeight: 132,
      margin: 8,
    }),
    { left: 120, top: 90 },
  )
})

test('deleting the active shelf switches to To Organize only for that shelf', () => {
  assert.equal(getActiveCategoryAfterDelete('技术', '技术'), 'uncategorized')
  assert.equal(getActiveCategoryAfterDelete('设计', '技术'), '设计')
  assert.equal(getActiveCategoryAfterDelete('all', '技术'), 'all')
})
```

- [ ] **Step 2: Run the tests and verify the module is missing**

Run:

```bash
./node_modules/.bin/tsx --test tests/bookCategorySidebarUtils.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `bookCategorySidebarUtils.ts`.

- [ ] **Step 3: Implement the pure utilities**

Create `src/views/bookCategorySidebarUtils.ts`:

```ts
const RESERVED_BOOK_CATEGORY_NAMES = new Set([
  '',
  '未分类',
  'Uncategorized',
  'Category',
  '分类',
])

export const isReservedBookCategory = (name?: string | null) =>
  RESERVED_BOOK_CATEGORY_NAMES.has((name || '').trim())

type ContextMenuPositionInput = {
  clientX: number
  clientY: number
  viewportWidth: number
  viewportHeight: number
  menuWidth: number
  menuHeight: number
  margin?: number
}

export const getContextMenuPosition = ({
  clientX,
  clientY,
  viewportWidth,
  viewportHeight,
  menuWidth,
  menuHeight,
  margin = 8,
}: ContextMenuPositionInput) => ({
  left: Math.max(margin, Math.min(clientX, viewportWidth - menuWidth - margin)),
  top: Math.max(margin, Math.min(clientY, viewportHeight - menuHeight - margin)),
})

export const getActiveCategoryAfterDelete = (
  activeCategory: string,
  deletedCategoryName: string,
) => (activeCategory === deletedCategoryName ? 'uncategorized' : activeCategory)
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
./node_modules/.bin/tsx --test tests/bookCategorySidebarUtils.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit the tested utilities**

```bash
git add src/views/bookCategorySidebarUtils.ts tests/bookCategorySidebarUtils.test.ts
git commit -m "test: define book sidebar interaction rules"
```

## Task 2: Add and Test Localized Sidebar Copy

**Files:**
- Create: `tests/bookCategoryTranslations.test.mjs`
- Modify: `src/locales/zh-CN.json:257-350`
- Modify: `src/locales/en-US.json:257-350`

- [ ] **Step 1: Write the failing localization contract test**

Create `tests/bookCategoryTranslations.test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const requiredKeys = [
  'sidebar_title',
  'to_organize',
  'my_shelves',
  'add_shelf',
  'rename_shelf',
  'edit_shelf_translations',
  'delete_shelf',
  'shelf_name_required',
  'shelf_name_duplicate',
  'toast_category_create_failed',
  'toast_category_update_failed',
  'toast_category_delete_failed',
  'confirm_delete_shelf_title',
  'confirm_delete_shelf_desc',
]

for (const locale of ['zh-CN', 'en-US']) {
  test(`${locale} contains all book sidebar translations`, async () => {
    const contents = await readFile(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')
    const translations = JSON.parse(contents)

    for (const key of requiredKeys) {
      assert.equal(typeof translations.books[key], 'string', `missing books.${key}`)
      assert.notEqual(translations.books[key].trim(), '')
    }
  })
}
```

- [ ] **Step 2: Run the localization test and verify it fails**

Run:

```bash
node --test tests/bookCategoryTranslations.test.mjs
```

Expected: FAIL with `missing books.sidebar_title`.

- [ ] **Step 3: Add the Chinese strings**

Add the new entries inside `books` in `src/locales/zh-CN.json`, change the existing `all_books` value from `全部书架` to `全部书籍`, and replace the existing `toast_category_deleted` value:

```json
"sidebar_title": "书库",
"to_organize": "待整理",
"my_shelves": "我的书架",
"add_shelf": "新增书架",
"rename_shelf": "重命名",
"edit_shelf_translations": "编辑其他语言名称…",
"delete_shelf": "删除书架…",
"shelf_name_required": "请输入书架名称",
"shelf_name_duplicate": "已存在同名书架",
"toast_category_create_failed": "书架创建失败，请重试",
"toast_category_update_failed": "书架更新失败，请重试",
"toast_category_delete_failed": "书架删除失败，请重试",
"confirm_delete_shelf_title": "删除书架",
"confirm_delete_shelf_desc": "删除书架“{{name}}”？其中 {{count}} 本书不会被删除，将移至“待整理”。",
"toast_category_deleted": "书架已删除，其中的书籍已移至“待整理”",
"all_books": "全部书籍"
```

- [ ] **Step 4: Add the English strings**

Add the new entries inside `books` in `src/locales/en-US.json`, keep the existing `all_books: "All Books"` value, and replace the existing `toast_category_deleted` value:

```json
"sidebar_title": "Library",
"to_organize": "To Organize",
"my_shelves": "My Shelves",
"add_shelf": "Add Shelf",
"rename_shelf": "Rename",
"edit_shelf_translations": "Edit Other Language Names…",
"delete_shelf": "Delete Shelf…",
"shelf_name_required": "Enter a shelf name",
"shelf_name_duplicate": "A shelf with this name already exists",
"toast_category_create_failed": "Could not create the shelf. Please try again.",
"toast_category_update_failed": "Could not update the shelf. Please try again.",
"toast_category_delete_failed": "Could not delete the shelf. Please try again.",
"confirm_delete_shelf_title": "Delete Shelf",
"confirm_delete_shelf_desc": "Delete the shelf “{{name}}”? Its {{count}} books will not be deleted and will move to “To Organize”.",
"toast_category_deleted": "Shelf deleted. Its books moved to “To Organize”."
```

- [ ] **Step 5: Run the localization test**

Run:

```bash
node --test tests/bookCategoryTranslations.test.mjs
```

Expected: 2 tests PASS.

- [ ] **Step 6: Commit the localization contract**

```bash
git add src/locales/zh-CN.json src/locales/en-US.json tests/bookCategoryTranslations.test.mjs
git commit -m "feat: add book shelf sidebar copy"
```

## Task 3: Build the Focused Sidebar Component

**Files:**
- Create: `src/views/BookCategorySidebar.tsx`
- Create: `src/views/BookCategorySidebar.css`

- [ ] **Step 1: Create the component API and transient UI state**

Create `src/views/BookCategorySidebar.tsx` with these exported types and state boundaries:

```tsx
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { BookOpen, Inbox, Languages, Library, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getContextMenuPosition } from './bookCategorySidebarUtils'
import './BookCategorySidebar.css'

export type BookShelf = {
  id: string | number
  name: string
}

type MutationResult = { ok: true } | { ok: false; error: string }

type BookCategorySidebarProps = {
  categories: BookShelf[]
  activeCategory: string
  allBooksCount: number
  toOrganizeCount: number
  getCategoryDisplayName: (category: BookShelf) => string
  getCategoryBookCount: (category: BookShelf) => number
  onSelectCategory: (category: string) => void
  onCreateCategory: (name: string) => Promise<MutationResult>
  onRenameCategory: (category: BookShelf, name: string) => Promise<MutationResult>
  onEditTranslations: (category: BookShelf) => void
  onRequestDelete: (category: BookShelf) => void
}

type ContextMenuState = {
  category: BookShelf
  left: number
  top: number
} | null

export const BookCategorySidebar = ({
  categories,
  activeCategory,
  allBooksCount,
  toOrganizeCount,
  getCategoryDisplayName,
  getCategoryBookCount,
  onSelectCategory,
  onCreateCategory,
  onRenameCategory,
  onEditTranslations,
  onRequestDelete,
}: BookCategorySidebarProps) => {
  const { t } = useTranslation()
  const [isAdding, setIsAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [inlineError, setInlineError] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const contextRowRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    const closeMenu = () => setContextMenu(null)
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
    firstItem?.focus()
  }, [contextMenu])

  const openContextMenu = (event: MouseEvent<HTMLButtonElement>, category: BookShelf) => {
    event.preventDefault()
    event.stopPropagation()
    contextRowRef.current = event.currentTarget
    const position = getContextMenuPosition({
      clientX: event.clientX,
      clientY: event.clientY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      menuWidth: 176,
      menuHeight: 132,
    })
    setContextMenu({ category, ...position })
  }

  const closeContextMenu = (restoreFocus = true) => {
    setContextMenu(null)
    if (restoreFocus) requestAnimationFrame(() => contextRowRef.current?.focus())
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || [],
    )
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      closeContextMenu()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(currentIndex + 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(currentIndex - 1 + items.length) % items.length]?.focus()
    }
  }

  const submitNewCategory = async (event: FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    const value = newName.trim()
    if (!value) {
      setInlineError(t('books.shelf_name_required'))
      return
    }
    setIsSubmitting(true)
    const result = await onCreateCategory(value)
    setIsSubmitting(false)
    if (!result.ok) {
      setInlineError(result.error)
      return
    }
    setNewName('')
    setInlineError('')
    setIsAdding(false)
  }

  const submitRename = async (category: BookShelf) => {
    if (isSubmitting) return
    const value = renameValue.trim()
    if (!value) {
      setInlineError(t('books.shelf_name_required'))
      return
    }
    setIsSubmitting(true)
    const result = await onRenameCategory(category, value)
    setIsSubmitting(false)
    if (!result.ok) {
      setInlineError(result.error)
      return
    }
    setInlineError('')
    setRenamingId(null)
  }

  const cancelInlineEdit = () => {
    setIsAdding(false)
    setNewName('')
    setRenamingId(null)
    setRenameValue('')
    setInlineError('')
  }

  return (
    <aside className="book-category-sidebar card" aria-label={t('books.sidebar_title')}>
      <div className="book-category-sidebar__title">{t('books.sidebar_title')}</div>

      <button
        type="button"
        className={`book-category-row ${activeCategory === 'all' ? 'active' : ''}`}
        onClick={() => onSelectCategory('all')}
      >
        <Library size={15} aria-hidden="true" />
        <span className="book-category-row__label">{t('books.all_books')}</span>
        <span className="book-category-row__count">{allBooksCount}</span>
      </button>

      <button
        type="button"
        className={`book-category-row book-category-row--inbox ${toOrganizeCount > 0 ? 'has-items' : ''} ${activeCategory === 'uncategorized' ? 'active' : ''}`}
        onClick={() => onSelectCategory('uncategorized')}
      >
        <Inbox size={15} aria-hidden="true" />
        <span className="book-category-row__label">{t('books.to_organize')}</span>
        <span className="book-category-row__count">{toOrganizeCount}</span>
      </button>

      <div className="book-category-sidebar__group-title">
        <span>{t('books.my_shelves')}</span>
        <button
          type="button"
          className="book-category-sidebar__add"
          aria-label={t('books.add_shelf')}
          title={t('books.add_shelf')}
          onClick={() => {
            setIsAdding(true)
            setRenamingId(null)
            setInlineError('')
          }}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="book-category-sidebar__list">
        {isAdding && (
          <form className="book-category-inline-editor" onSubmit={submitNewCategory}>
            <BookOpen size={14} aria-hidden="true" />
            <input
              autoFocus
              value={newName}
              aria-label={t('books.add_shelf')}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') cancelInlineEdit()
              }}
              onBlur={() => {
                if (!isSubmitting) cancelInlineEdit()
              }}
            />
          </form>
        )}

        {categories.map((category) => {
          const isRenaming = renamingId === category.id
          if (isRenaming) {
            return (
              <form
                key={category.id}
                className="book-category-inline-editor"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitRename(category)
                }}
              >
                <BookOpen size={14} aria-hidden="true" />
                <input
                  autoFocus
                  value={renameValue}
                  aria-label={t('books.rename_shelf')}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') cancelInlineEdit()
                  }}
                  onBlur={() => {
                    if (!isSubmitting) void submitRename(category)
                  }}
                />
              </form>
            )
          }

          return (
            <button
              key={category.id}
              type="button"
              className={`book-category-row ${activeCategory === category.name ? 'active' : ''} ${contextMenu?.category.id === category.id ? 'context-open' : ''}`}
              onClick={() => onSelectCategory(category.name)}
              onContextMenu={(event) => openContextMenu(event, category)}
            >
              <BookOpen size={14} aria-hidden="true" />
              <span className="book-category-row__label" title={getCategoryDisplayName(category)}>
                {getCategoryDisplayName(category)}
              </span>
              <span className="book-category-row__count">{getCategoryBookCount(category)}</span>
            </button>
          )
        })}
      </div>

      {inlineError && <div className="book-category-inline-error">{inlineError}</div>}

      {contextMenu && (
        <div
          ref={menuRef}
          role="menu"
          className="book-category-context-menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenamingId(contextMenu.category.id)
              setRenameValue(getCategoryDisplayName(contextMenu.category))
              closeContextMenu(false)
            }}
          >
            <Pencil size={14} /> {t('books.rename_shelf')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onEditTranslations(contextMenu.category)
              closeContextMenu(false)
            }}
          >
            <Languages size={14} /> {t('books.edit_shelf_translations')}
          </button>
          <div className="book-category-context-menu__separator" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              onRequestDelete(contextMenu.category)
              closeContextMenu(false)
            }}
          >
            <Trash2 size={14} /> {t('books.delete_shelf')}
          </button>
        </div>
      )}
    </aside>
  )
}
```

- [ ] **Step 2: Add stable, theme-aware sidebar CSS**

Create `src/views/BookCategorySidebar.css`:

```css
.book-category-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.book-category-sidebar__title {
  padding: 2px 10px 10px;
  font-size: 13px;
  font-weight: 800;
}

.book-category-row {
  width: 100%;
  height: 38px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) minmax(26px, auto);
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.book-category-row:hover,
.book-category-row.context-open {
  background: color-mix(in srgb, var(--text-main) 5%, transparent);
  color: var(--text-main);
}

.book-category-row.active {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  color: var(--color-accent);
  font-weight: 700;
}

.book-category-row--inbox.has-items:not(.active) {
  color: var(--color-warn);
}

.book-category-row__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.book-category-row__count {
  min-width: 24px;
  height: 20px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-muted) 10%, transparent);
  color: currentColor;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.book-category-sidebar__group-title {
  height: 38px;
  margin-top: 10px;
  padding: 0 8px 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.book-category-sidebar__add {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--bg-surface);
  color: var(--text-muted);
  cursor: pointer;
}

.book-category-sidebar__add:hover {
  color: var(--color-accent);
  border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-border));
}

.book-category-sidebar__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.book-category-inline-editor {
  height: 38px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  color: var(--color-accent);
}

.book-category-inline-editor input {
  width: 100%;
  min-width: 0;
  padding: 5px 7px;
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  outline: none;
  background: var(--bg-surface);
  color: var(--text-main);
  font: inherit;
  font-size: 12px;
}

.book-category-inline-error {
  padding: 6px 10px 0 36px;
  color: var(--color-danger);
  font-size: 10px;
}

.book-category-context-menu {
  position: fixed;
  z-index: 2100;
  width: 176px;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--bg-surface);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.book-category-context-menu button {
  width: 100%;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-main);
  cursor: pointer;
  text-align: left;
  font-size: 11px;
}

.book-category-context-menu button:hover,
.book-category-context-menu button:focus-visible {
  background: color-mix(in srgb, var(--text-main) 6%, transparent);
  outline: none;
}

.book-category-context-menu button.danger {
  color: var(--color-danger);
}

.book-category-context-menu__separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--color-border);
}
```

- [ ] **Step 3: Build to catch TypeScript and CSS integration errors**

Run:

```bash
npm run build
```

Expected: `tsc -b` and `vite build` exit with code 0.

- [ ] **Step 4: Commit the standalone sidebar component**

```bash
git add src/views/BookCategorySidebar.tsx src/views/BookCategorySidebar.css
git commit -m "feat: add book category sidebar component"
```

## Task 4: Integrate Selection, Inline Create, Rename, and Translation Editing

**Files:**
- Modify: `src/views/Books.tsx:1-480`
- Modify: `src/views/Books.tsx:1460-1710`
- Modify: `src/views/Books.tsx:3050-3160`

- [ ] **Step 1: Replace category-specific icon imports and import the new component**

In `src/views/Books.tsx`, remove `Tag`, `Bookmark`, `Edit3`, and the category-hover-only CSS rule. Add:

```tsx
import { BookCategorySidebar, type BookShelf } from './BookCategorySidebar'
import { isReservedBookCategory } from './bookCategorySidebarUtils'
```

Keep `Edit3` only if it is used elsewhere in `Books.tsx`; verify with:

```bash
rg -n '\b(Tag|Bookmark|Edit3)\b' src/views/Books.tsx
```

Expected: no remaining category-sidebar-only references after the JSX replacement.

- [ ] **Step 2: Replace modal-add state with callback-friendly category creation**

Remove these states:

```tsx
const [isAddCatOpen, setIsAddCatOpen] = useState(false)
const [newCatName, setNewCatName] = useState('')
const [newCatTrans, setNewCatTrans] = useState<{ [key: string]: string }>({})
const [isAddCatTransOpen, setIsAddCatTransOpen] = useState(false)
```

Replace `confirmAddCategory` with:

```tsx
const createCategory = async (name: string) => {
  if (!api) return { ok: false as const, error: t('books.toast_category_create_failed') }
  const mainName = name.trim()
  if (!mainName) return { ok: false as const, error: t('books.shelf_name_required') }
  if (
    isReservedBookCategory(mainName) ||
    categories.some((category) => category.name === mainName)
  ) {
    return { ok: false as const, error: t('books.shelf_name_duplicate') }
  }

  const res = await api.dbQuery(
    'books',
    'INSERT INTO categories (name, sort_order) VALUES (?, ?)',
    [mainName, categories.length + 1],
  )
  if (!res?.success) {
    await loadData()
    return { ok: false as const, error: t('books.toast_category_create_failed') }
  }

  let categoryId = res.data?.lastInsertRowid
  if (!categoryId) {
    const findRes = await api.dbQuery('books', 'SELECT id FROM categories WHERE name = ?', [mainName])
    categoryId = findRes?.success ? findRes.data[0]?.id : null
  }
  let translationSaved = Boolean(categoryId)
  if (categoryId) {
    const translationResult = await api.dbQuery(
      'books',
      'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES (?, ?, ?, ?)',
      ['category', String(categoryId), i18n.language, mainName],
    )
    translationSaved = Boolean(translationResult?.success)
  }

  await loadData()
  setActiveCategory(mainName)
  showToast(
    translationSaved
      ? t('books.toast_category_added', { name: mainName })
      : t('books.toast_category_update_failed'),
  )
  return { ok: true as const }
}
```

- [ ] **Step 3: Add an inline rename callback without removing the translation editor**

Add this callback before the existing `confirmEditCategory` function:

```tsx
const renameCategoryInline = async (category: BookShelf, name: string) => {
  if (!api) return { ok: false as const, error: t('books.toast_category_update_failed') }
  const newName = name.trim()
  const oldName = category.name
  if (!newName) return { ok: false as const, error: t('books.shelf_name_required') }
  if (
    isReservedBookCategory(newName) ||
    categories.some((item) => item.name === newName && item.id !== category.id)
  ) {
    return { ok: false as const, error: t('books.shelf_name_duplicate') }
  }
  if (newName === oldName) return { ok: true as const }

  const booksResult = await api.dbQuery(
    'books',
    'UPDATE books SET category = ? WHERE category = ?',
    [newName, oldName],
  )
  const categoryResult = await api.dbQuery(
    'books',
    'UPDATE categories SET name = ? WHERE id = ?',
    [newName, category.id],
  )
  const translationResult = await api.dbQuery(
    'books',
    'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES (?, ?, ?, ?)',
    ['category', String(category.id), i18n.language, newName],
  )

  if (!booksResult?.success || !categoryResult?.success || !translationResult?.success) {
    await loadData()
    return { ok: false as const, error: t('books.toast_category_update_failed') }
  }

  if (activeCategory === oldName) setActiveCategory(newName)
  await loadData()
  showToast(t('books.toast_category_updated'))
  return { ok: true as const }
}
```

- [ ] **Step 4: Extract the existing translation-modal initialization into one handler**

Add:

```tsx
const openCategoryTranslationEditor = (category: BookShelf) => {
  setEditingCategory(category)
  const currentLocale = i18n.language
  const mainTranslation = translations.find(
    (translation) =>
      translation.entity_type === 'category' &&
      translation.entity_id === String(category.id) &&
      translation.locale === currentLocale,
  )
  setEditCatName(mainTranslation ? mainTranslation.translation : category.name)

  const otherTranslations: Record<string, string> = {}
  for (const locale of SUPPORTED_LOCALES) {
    if (locale.code === currentLocale) continue
    const match = translations.find(
      (translation) =>
        translation.entity_type === 'category' &&
        translation.entity_id === String(category.id) &&
        translation.locale === locale.code,
    )
    otherTranslations[locale.code] = match ? match.translation : ''
  }
  setEditCatTrans(otherTranslations)
  setIsEditCatTransOpen(true)
}
```

- [ ] **Step 5: Make the existing translation editor report every failed write**

Replace `confirmEditCategory` with:

```tsx
const confirmEditCategory = async () => {
  if (!api || !editingCategory || !editCatName.trim()) return
  const newName = editCatName.trim()
  const oldName = editingCategory.name

  if (
    isReservedBookCategory(newName) ||
    categories.some((category) => category.name === newName && category.id !== editingCategory.id)
  ) {
    showToast(t('books.shelf_name_duplicate'))
    return
  }

  const results = []
  results.push(
    await api.dbQuery('books', 'UPDATE books SET category = ? WHERE category = ?', [
      newName,
      oldName,
    ]),
  )
  results.push(
    await api.dbQuery('books', 'UPDATE categories SET name = ? WHERE id = ?', [
      newName,
      editingCategory.id,
    ]),
  )

  const categoryId = String(editingCategory.id)
  results.push(
    await api.dbQuery(
      'books',
      'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES (?, ?, ?, ?)',
      ['category', categoryId, i18n.language, newName],
    ),
  )
  for (const locale of SUPPORTED_LOCALES) {
    if (locale.code === i18n.language) continue
    const translation = (editCatTrans[locale.code] || '').trim() || newName
    results.push(
      await api.dbQuery(
        'books',
        'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES (?, ?, ?, ?)',
        ['category', categoryId, locale.code, translation],
      ),
    )
  }

  if (results.some((result) => !result?.success)) {
    await loadData()
    showToast(t('books.toast_category_update_failed'))
    return
  }

  if (activeCategory === oldName) setActiveCategory(newName)
  setEditingCategory(null)
  setEditCatName('')
  setEditCatTrans({})
  setIsEditCatTransOpen(false)
  await loadData()
  showToast(t('books.toast_category_updated'))
}
```

- [ ] **Step 6: Replace the full left-pane JSX with the focused component**

Replace the current `<aside className="card">...</aside>` block with:

```tsx
<BookCategorySidebar
  categories={categories.filter((category) => !isReservedBookCategory(category.name))}
  activeCategory={activeCategory}
  allBooksCount={books.length}
  toOrganizeCount={uncategorizedBooksCount}
  getCategoryDisplayName={(category) => getCategoryDisplayName(category.name, category.id)}
  getCategoryBookCount={(category) =>
    books.filter((book) => isBookInCategory(book, category)).length
  }
  onSelectCategory={setActiveCategory}
  onCreateCategory={createCategory}
  onRenameCategory={renameCategoryInline}
  onEditTranslations={openCategoryTranslationEditor}
  onRequestDelete={setDeletingCategory}
/>
```

Delete the old hover action markup and the `.nav-item:hover .cat-actions` style rule.

- [ ] **Step 7: Remove the old add-category modal**

Delete the complete JSX block guarded by `isAddCatOpen`. Keep the translation edit modal guarded by `editingCategory` because the right-click “Edit Other Language Names…” action still uses it.

- [ ] **Step 8: Run focused tests and build**

Run:

```bash
./node_modules/.bin/tsx --test tests/bookCategorySidebarUtils.test.ts
node --test tests/bookCategoryTranslations.test.mjs
npm run build
```

Expected: 6 focused tests PASS and the production build exits with code 0.

- [ ] **Step 9: Commit the integrated sidebar**

```bash
git add src/views/Books.tsx src/views/BookCategorySidebar.tsx src/views/BookCategorySidebar.css
git commit -m "feat: integrate book shelf sidebar"
```

## Task 5: Make Deletion Explain and Preserve Book Data

**Files:**
- Modify: `src/views/Books.tsx:455-486`
- Modify: `src/views/Books.tsx:3340-3415`

- [ ] **Step 1: Import the tested selection fallback**

Extend the utility import:

```tsx
import {
  getActiveCategoryAfterDelete,
  isReservedBookCategory,
} from './bookCategorySidebarUtils'
```

- [ ] **Step 2: Update the delete handler to switch an active deleted shelf to To Organize**

Replace `confirmDeleteCategory` with:

```tsx
const confirmDeleteCategory = async () => {
  if (!api || !deletingCategory) return
  const category = deletingCategory
  const categoryName = category.name
  const nextActiveCategory = getActiveCategoryAfterDelete(activeCategory, categoryName)

  const moveResult = await api.dbQuery(
    'books',
    "UPDATE books SET category = '未分类' WHERE category = ?",
    [categoryName],
  )
  const deleteResult = await api.dbQuery(
    'books',
    'DELETE FROM categories WHERE id = ?',
    [category.id],
  )
  const translationResult = await api.dbQuery(
    'books',
    "DELETE FROM translations WHERE entity_type = 'category' AND entity_id = ?",
    [String(category.id)],
  )

  if (!moveResult?.success || !deleteResult?.success || !translationResult?.success) {
    setDeletingCategory(null)
    await loadData()
    showToast(t('books.toast_category_delete_failed'))
    return
  }

  setDeletingCategory(null)
  setActiveCategory(nextActiveCategory)
  await loadData()
  showToast(t('books.toast_category_deleted'))
}
```

- [ ] **Step 3: Show the affected book count in the confirmation dialog**

Directly before the component return, compute:

```tsx
const deletingCategoryBookCount = deletingCategory
  ? books.filter((book) => isBookInCategory(book, deletingCategory)).length
  : 0
```

In the delete dialog, replace the title and description translation calls with:

```tsx
<h3 style={{ ...modalTitleStyle, color: 'var(--color-danger)' }}>
  {t('books.confirm_delete_shelf_title')}
</h3>
<p style={{ fontSize: '13px', color: 'var(--text-main)', margin: '0 0 12px', lineHeight: 1.5 }}>
  {t('books.confirm_delete_shelf_desc', {
    name: getCategoryDisplayName(deletingCategory.name, deletingCategory.id),
    count: deletingCategoryBookCount,
  })}
</p>
```

Keep the cancel and destructive confirmation buttons. Use `var(--color-danger)` for both background and border instead of a hard-coded red.

- [ ] **Step 4: Run the tested delete fallback and production build**

Run:

```bash
./node_modules/.bin/tsx --test tests/bookCategorySidebarUtils.test.ts
npm run build
```

Expected: 4 utility tests PASS and the production build exits with code 0.

- [ ] **Step 5: Commit safe shelf deletion**

```bash
git add src/views/Books.tsx
git commit -m "feat: clarify book shelf deletion"
```

## Task 6: Verify Desktop Interaction and Visual Stability

**Files:**
- Modify if verification finds issues: `src/views/BookCategorySidebar.tsx`
- Modify if verification finds issues: `src/views/BookCategorySidebar.css`

- [ ] **Step 1: Start the app in development mode**

Run:

```bash
npm run dev
```

Expected: Vite starts and the Electron window opens without renderer errors.

- [ ] **Step 2: Verify fixed access and selection behavior**

In the book library:

1. Confirm the top entries read “全部书籍” and “待整理” in Chinese.
2. Left-click each entry and confirm the grid and count match its filter.
3. Right-click each fixed entry and confirm no custom context menu appears.
4. Switch to English and confirm “All Books”, “To Organize”, and “My Shelves” fit the sidebar.

Expected: fixed entries filter correctly, never expose management actions, and do not shift horizontally.

- [ ] **Step 3: Verify custom shelf create and rename behavior**

1. Click `＋`, type `测试书架`, and press Enter.
2. Confirm the new shelf is selected and appears under “我的书架”.
3. Right-click it, choose “重命名”, enter `测试书架 2`, and press Enter.
4. Right-click again, open “编辑其他语言名称…”, set the English name to `Test Shelf`, and save.
5. Switch locale and verify the English display name.

Expected: the row remains a fixed width in every state, the current filter survives rename, and translation editing remains available.

- [ ] **Step 4: Verify keyboard and context-menu behavior**

1. Right-click a custom shelf near the bottom of the window.
2. Confirm the menu opens upward or leftward as needed and stays fully visible.
3. Press ArrowDown and ArrowUp; confirm focus moves through menu items.
4. Press Esc; confirm the menu closes and focus returns to the shelf row.
5. Reopen the menu, click outside it, and confirm it closes.

Expected: no browser default menu appears and all menu items remain reachable by keyboard.

- [ ] **Step 5: Verify deletion safety**

1. Add or assign at least one test book to `测试书架 2`.
2. Right-click the shelf and choose “删除书架…”.
3. Confirm the dialog shows the shelf name and exact book count.
4. Confirm deletion.
5. Verify the book still exists under “待整理” and the sidebar switches there if the deleted shelf was active.

Expected: only the shelf is deleted; its books remain available.

- [ ] **Step 6: Verify all visual themes**

Switch through Minimal, Dense, Card, and Dark Tech themes. For each theme, verify default, hover, active, inbox count, inline editor, context menu, and delete dialog contrast.

Expected: text and focus states remain readable without hard-coded light-theme backgrounds.

- [ ] **Step 7: Commit any verification fixes**

If verification required changes:

```bash
git add src/views/BookCategorySidebar.tsx src/views/BookCategorySidebar.css src/views/Books.tsx
git commit -m "fix: polish book shelf sidebar interactions"
```

If no files changed, skip this commit.

## Task 7: Run the Full Verification Suite

**Files:**
- No production changes expected.

- [ ] **Step 1: Run every automated test**

Run:

```bash
npm test
```

Expected: all existing and new tests PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: ESLint exits with code 0 and reports no new warnings or errors.

- [ ] **Step 3: Run a clean production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build successfully.

- [ ] **Step 4: Review the final diff for scope and accidental changes**

Run:

```bash
git status --short
git diff --check 0270a9d..HEAD
git diff --stat 0270a9d..HEAD
```

Expected: only the plan plus the planned sidebar component, utilities, tests, `Books.tsx`, and locale files changed; `git diff --check` prints no errors.

- [ ] **Step 5: Record completion**

If Task 7 reveals no additional changes, do not create an empty commit. Report the test, lint, build, and manual verification results with the final commit hashes.
