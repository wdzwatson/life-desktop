# SQLite Value Binding Fix Design

## Problem

Several renderer-side `dbQuery` calls use double quotes around SQL values, for example:

```sql
SELECT * FROM tasks WHERE status != "已关闭"
```

SQLite treats double-quoted tokens as identifiers. With the SQLite configuration bundled by the current Electron runtime, preparing this statement looks for a column named `已关闭` and fails with `SQLITE_ERROR`. The main-process stack trace points to the shared `db:query` handler because that handler prepares SQL supplied by the renderer; it is not the source of the malformed statement.

An AST scan found 16 renderer queries with the same value-quoting pattern across `Toolbox`, `Dashboard`, `Tasks`, `Settings`, `Books`, and `Notes`. The affected values include task statuses, the uncategorized book category, and translation entity types.

## Chosen Approach

Replace every affected inline value with a `?` placeholder and pass the value through the existing `params` argument. Examples:

```ts
api.dbQuery('tasks', 'SELECT * FROM tasks WHERE status != ?', ['已关闭'])
api.dbQuery('books', 'UPDATE books SET category = ? WHERE category = ?', ['未分类', name])
```

This follows the query style already used elsewhere in the project, avoids quoting and escaping mistakes, and keeps values separate from SQL structure. The shared main-process query executor will remain unchanged.

The generated `dist-electron/main.js` file will not be edited manually. The normal build will regenerate build artifacts from source.

## Scope

- Update all 16 currently detected `dbQuery` statements that use double quotes for SQL values.
- Preserve query behavior and parameter order at each call site.
- Add a source-level regression test that parses TypeScript/TSX files and reports literal `dbQuery` SQL containing double-quoted value tokens.
- Run the targeted regression test, the full test suite, lint, and production build.

No database schema migration or user-data rewrite is required because the defect is in query text, not stored data.

## Error Handling and Compatibility

Existing `dbQuery` result handling remains unchanged. Parameter binding is supported by `better-sqlite3` for both reads and writes and works with Chinese and English text values. Existing databases remain compatible.

## Test Strategy

1. Add the regression test before changing production call sites and verify that it fails on the detected queries.
2. Parameterize the affected statements and verify that the regression test passes.
3. Re-run the AST scan to confirm that no literal renderer query still uses double quotes for values.
4. Run the full tests, lint, and build to catch parameter-count, type, and compilation regressions.

## Success Criteria

- Loading active tasks no longer prepares `status != "已关闭"`.
- Closing child tasks, refreshing overdue tasks, deleting book categories, and saving book/notebook translations use bound values.
- The regression test detects future reintroduction of this SQL pattern.
- Tests, lint, and build complete successfully.
