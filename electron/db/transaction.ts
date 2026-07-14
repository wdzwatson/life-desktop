import type Database from 'better-sqlite3'

export type DbTransactionStatement = {
  sql: string
  params?: unknown[]
}

export function runDbTransaction(
  db: Database.Database,
  statements: DbTransactionStatement[],
): Database.RunResult[] {
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new TypeError('Transaction statements must be a non-empty array')
  }

  for (const statement of statements) {
    if (!statement || typeof statement.sql !== 'string' || !statement.sql.trim()) {
      throw new TypeError('Each transaction statement must include non-empty SQL')
    }
    if (statement.params !== undefined && !Array.isArray(statement.params)) {
      throw new TypeError('Transaction statement params must be an array')
    }
  }

  return db.transaction(() =>
    statements.map((statement) => db.prepare(statement.sql).run(...(statement.params ?? []))),
  )()
}
