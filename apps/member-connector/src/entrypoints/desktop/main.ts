import { app, protocol } from 'electron'
import { openDesktopAcquisitionHost } from '../../adapters/browser/electron/desktop-acquisition-host.js'
import { createNaverDesktopAcquisitionProvider } from '../../adapters/providers/naver/desktop/acquisition-provider.js'
import { checkLocalControl } from './check-local-control.js'

app.enableSandbox()
app.setName('GotgotganMemberConnector')
protocol.registerSchemesAsPrivileged([{
  scheme: 'gotgotgan-desktop', privileges: { standard: true, secure: true },
}])

const localCheck = process.argv.includes('--check-desktop')
if (!process.argv.includes('--desktop-naver') && !localCheck) {
  app.exit(1)
} else if (!app.requestSingleInstanceLock()) {
  if (localCheck) {
    process.stderr.write('Desktop smoke unavailable: another Connector instance is running.\n')
    app.exit(1)
  } else app.quit()
} else {
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(async () => {
    const window = await openDesktopAcquisitionHost(createNaverDesktopAcquisitionProvider, { visible: !localCheck })
    if (localCheck) {
      await checkLocalControl(window)
      process.stdout.write('Desktop local control and isolated IPC smoke passed.\n')
      window.close()
    }
  }).catch(() => {
    process.stderr.write('Desktop Connector startup failed.\n')
    app.exit(1)
  })
}
