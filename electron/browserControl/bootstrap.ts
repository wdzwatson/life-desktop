import { app } from 'electron'
import { isNativeMessagingHostLaunch, runNativeMessagingHost } from './nativeMessagingHost'

if (isNativeMessagingHostLaunch()) {
  const exitCode = await runNativeMessagingHost()
  app.exit(exitCode)
} else {
  await import('../main')
}
