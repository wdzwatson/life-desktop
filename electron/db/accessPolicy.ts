export function isDirectDbAccessBlocked(dbName: string) {
  return dbName === 'vault'
}

export function getDirectDbAccessError(dbName: string) {
  if (!isDirectDbAccessBlocked(dbName)) return null
  return 'Direct vault database access is disabled. Use the dedicated vault API.'
}
