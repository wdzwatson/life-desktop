import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const platform = process.platform
const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : null
if (!arch || !['win32', 'darwin', 'linux'].includes(platform)) {
  throw new Error(`Native browser host is not supported on ${platform}/${process.arch}.`)
}

const root = process.cwd()
const outputDir = path.join(root, 'build', 'native-host')
const outputName = platform === 'win32' ? 'lifeos-native-host.exe' : 'lifeos-native-host'
const outputPath = path.join(outputDir, outputName)
await mkdir(outputDir, { recursive: true })

const go = spawn('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', outputPath, '.'], {
  cwd: path.join(root, 'native-host'),
  env: {
    ...process.env,
    CGO_ENABLED: '0',
    GOOS: platform === 'win32' ? 'windows' : platform,
    GOARCH: arch,
  },
  stdio: 'inherit',
})

const exitCode = await new Promise((resolve, reject) => {
  go.once('error', reject)
  go.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1))
})
if (exitCode !== 0) throw new Error(`go build failed with exit code ${exitCode}.`)
console.log(`Built native browser host: ${outputPath}`)
