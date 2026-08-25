import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const benchmarkSource = readFileSync(
  new URL('../scripts/benchmark-pdf-reader-performance.mjs', import.meta.url),
  'utf8',
)
const domBenchmark = readFileSync(
  new URL('../scripts/pdf-reader-dom-benchmark.html', import.meta.url),
  'utf8',
)
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('PDF reader benchmark keeps all fixed content shapes and jump phases', () => {
  for (const sample of ['scanned', 'hidden-ocr', 'text', 'mixed']) {
    assert.match(benchmarkSource, new RegExp(`id: '${sample}'`))
  }
  for (const metric of [
    'coldPageStageMs',
    'hotPageStageMs',
    'consecutivePageStageMs',
    'textContentMs',
  ]) {
    assert.match(benchmarkSource, new RegExp(metric))
  }
  assert.equal(
    packageJson.scripts['benchmark:pdf-reader'],
    'node scripts/benchmark-pdf-reader-performance.mjs',
  )
})

test('PDF reader DOM benchmark covers the 320-page list and layout-sensitive actions', () => {
  assert.match(domBenchmark, /const pageCount = 320/)
  assert.match(domBenchmark, /const sampleCount = 40/)
  assert.match(domBenchmark, /coldListCreateP95Ms/)
  assert.match(domBenchmark, /outlineJumpLookupP95Ms/)
  assert.match(domBenchmark, /consecutiveJumpLookupP95Ms/)
  assert.match(domBenchmark, /resizeLayoutP95Ms/)
  assert.match(domBenchmark, /\.offsetTop/)
  assert.match(domBenchmark, /list\.scrollHeight/)
})
