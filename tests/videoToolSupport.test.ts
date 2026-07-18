import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { getManagedVideoToolInstallSupport } from '../electron/video/toolSupport'

test('managed video tool support matches implemented platform downloads', () => {
  assert.deepEqual(getManagedVideoToolInstallSupport('darwin', 'x64'), {
    'yt-dlp': true,
    ffmpeg: true,
  })
  assert.deepEqual(getManagedVideoToolInstallSupport('win32', 'x64'), {
    'yt-dlp': true,
    ffmpeg: false,
  })
  assert.deepEqual(getManagedVideoToolInstallSupport('linux', 'arm64'), {
    'yt-dlp': true,
    ffmpeg: false,
  })
  assert.deepEqual(getManagedVideoToolInstallSupport('aix', 'x64'), {
    'yt-dlp': false,
    ffmpeg: false,
  })
})

test('Chinese and English settings explain manual ffmpeg installation', () => {
  for (const locale of ['en-US', 'zh-CN']) {
    const resource = JSON.parse(
      fs.readFileSync(path.join('src', 'locales', `${locale}.json`), 'utf8'),
    )
    assert.equal(typeof resource.settings.video_ffmpeg_manual_install_note, 'string')
    assert.ok(resource.settings.video_ffmpeg_manual_install_note.length > 20)
  }
})
