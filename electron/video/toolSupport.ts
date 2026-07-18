export type ManagedVideoTool = 'yt-dlp' | 'ffmpeg'

export function getManagedVideoToolInstallSupport(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
) {
  const supportedDesktopArch = ['x64', 'arm64'].includes(arch)
  return {
    'yt-dlp': supportedDesktopArch && ['darwin', 'win32', 'linux'].includes(platform),
    ffmpeg: supportedDesktopArch && platform === 'darwin',
  } satisfies Record<ManagedVideoTool, boolean>
}
