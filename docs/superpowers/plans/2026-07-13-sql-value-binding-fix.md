# SQLite Value Binding Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace renderer SQL value literals written with double quotes by bound parameters and prevent the pattern from returning.

**Architecture:** Keep the existing renderer-to-main `dbQuery(dbName, sql, params)` boundary. Correct malformed SQL at each renderer call site by moving values into `params`, while a TypeScript-AST regression test enforces the project convention that literal `dbQuery` SQL must not contain embedded double-quoted tokens.

**Tech Stack:** TypeScript, React, Electron IPC, better-sqlite3, Node test runner, TypeScript compiler API, tsx.

---

### Task 1: Add the SQL literal regression test

**Files:**
- Create: `tests/sqlValueBinding.test.ts`

- [ ] **Step 1: Write the failing test**

Create a test that recursively parses renderer TypeScript files and records literal `dbQuery` SQL containing embedded double quotes:

```ts
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(entryPath)
    return /\.tsx?$/.test(entry.name) ? [entryPath] : []
  })
}

test('renderer dbQuery SQL binds values instead of using double-quoted literals', () => {
  const violations: string[] = []

  for (const filePath of collectSourceFiles(path.resolve('src'))) {
    const sourceFile = ts.createSourceFile(
      filePath,
      readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'dbQuery' &&
        node.arguments.length >= 2
      ) {
        const sqlArgument = node.arguments[1]
        if (
          (ts.isStringLiteralLike(sqlArgument) || ts.isNoSubstitutionTemplateLiteral(sqlArgument)) &&
          /\b(?:SELECT|UPDATE|INSERT|DELETE)\b/i.test(sqlArgument.text) &&
          /"[^"]+"/.test(sqlArgument.text)
        ) {
          const position = sourceFile.getLineAndCharacterOfPosition(sqlArgument.getStart(sourceFile))
          violations.push(
            `${path.relative(process.cwd(), filePath)}:${position.line + 1} ${sqlArgument.text}`,
          )
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  assert.deepEqual(violations, [])
})
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npx tsx --test tests/sqlValueBinding.test.ts`

Expected: FAIL with 16 entries from `Books.tsx`, `Dashboard.tsx`, `Notes.tsx`, `Settings.tsx`, `Tasks.tsx`, and `Toolbox.tsx`.

### Task 2: Bind task and book-category values

**Files:**
- Modify: `src/views/Toolbox.tsx:47-50`
- Modify: `src/views/Dashboard.tsx:125-129`
- Modify: `src/views/Tasks.tsx:236-240`
- Modify: `src/views/Settings.tsx:291-293`

- [ ] **Step 1: Parameterize task filtering and updates**

Use these query/parameter pairs:

```ts
await api.dbQuery(
  'tasks',
  'SELECT * FROM tasks WHERE is_completed = 0 AND status != ?',
  ['已关闭'],
)
```

```ts
await api.dbQuery(
  'tasks',
  'SELECT * FROM tasks WHERE due_date = ? OR status = ? LIMIT 3',
  [todayYMD, '已逾期'],
)
```

```ts
await api.dbQuery(
  'tasks',
  'UPDATE tasks SET is_completed = 1, status = ?, progress = 100 WHERE parent_id = ?',
  ['已关闭', task.id],
)
```

- [ ] **Step 2: Parameterize the uncategorized book update**

```ts
await api.dbQuery('books', 'UPDATE books SET category = ? WHERE category = ?', [
  '未分类',
  name,
])
```

- [ ] **Step 3: Re-run the focused test**

Run: `npx tsx --test tests/sqlValueBinding.test.ts`

Expected: FAIL only for the remaining translation queries in `Books.tsx` and `Notes.tsx`.

### Task 3: Bind translation entity types

**Files:**
- Modify: `src/views/Books.tsx:294-309`
- Modify: `src/views/Books.tsx:424-439`
- Modify: `src/views/Notes.tsx:476-507`
- Modify: `src/views/Notes.tsx:538-568`

- [ ] **Step 1: Parameterize all book category translation inserts**

Change each book translation SQL statement to:

```ts
'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES (?, ?, ?, ?)'
```

Prepend `'category'` to each parameter array, for example:

```ts
['category', String(catId), i18n.language, mainName]
['category', String(catId), locale.code, transValue]
['category', catIdStr, i18n.language, newName]
['category', catIdStr, locale.code, transValue]
```

- [ ] **Step 2: Parameterize all notebook translation inserts**

Use the same four-placeholder SQL. Prepend the appropriate entity type to every parameter array:

```ts
['notebook', nbIdStr, i18n.language, mainName]
['notebook', nbIdStr, locale.code, val]
['notebook_category', categoryToSave, i18n.language, nbModalCategory.trim()]
['notebook_category', categoryToSave, locale.code, val]
```

Apply the same arrays in both notebook creation and rename flows.

- [ ] **Step 3: Verify GREEN**

Run: `npx tsx --test tests/sqlValueBinding.test.ts`

Expected: PASS, 1 test passed and 0 failed.

- [ ] **Step 4: Check formatting and the focused diff**

Run: `npx prettier --check tests/sqlValueBinding.test.ts src/views/Toolbox.tsx src/views/Dashboard.tsx src/views/Tasks.tsx src/views/Settings.tsx src/views/Books.tsx src/views/Notes.tsx`

Expected: all matched files use Prettier formatting. If not, run `npx prettier --write` on only these files and re-run the focused test.

### Task 4: Verify and commit the repair

**Files:**
- Verify: `tests/sqlValueBinding.test.ts`
- Verify: `src/views/Toolbox.tsx`
- Verify: `src/views/Dashboard.tsx`
- Verify: `src/views/Tasks.tsx`
- Verify: `src/views/Settings.tsx`
- Verify: `src/views/Books.tsx`
- Verify: `src/views/Notes.tsx`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: exit code 0 with no failed tests.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: exit code 0 with no ESLint errors.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: exit code 0 and regenerated application/Electron bundles.

- [ ] **Step 4: Confirm no affected SQL remains**

Run: `npx tsx --test tests/sqlValueBinding.test.ts`

Expected: PASS.

- [ ] **Step 5: Inspect and commit only the repair files**

Run:

```bash
git diff --check -- tests/sqlValueBinding.test.ts src/views/Toolbox.tsx src/views/Dashboard.tsx src/views/Tasks.tsx src/views/Settings.tsx src/views/Books.tsx src/views/Notes.tsx
git add tests/sqlValueBinding.test.ts src/views/Toolbox.tsx src/views/Dashboard.tsx src/views/Tasks.tsx src/views/Settings.tsx src/views/Books.tsx src/views/Notes.tsx
git commit -m "fix: bind sqlite query values"
```

Expected: the commit contains only the regression test and the seven renderer source files; unrelated pre-existing working-tree changes remain unstaged.
