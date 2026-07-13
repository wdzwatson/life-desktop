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
          (ts.isStringLiteralLike(sqlArgument) ||
            ts.isNoSubstitutionTemplateLiteral(sqlArgument)) &&
          /\b(?:SELECT|UPDATE|INSERT|DELETE)\b/i.test(sqlArgument.text) &&
          /"[^"]+"/.test(sqlArgument.text)
        ) {
          const position = sourceFile.getLineAndCharacterOfPosition(
            sqlArgument.getStart(sourceFile),
          )
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
