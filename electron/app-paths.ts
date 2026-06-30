import os from 'node:os'
import path from 'node:path'

interface ElectronAppModule {
  app?: {
    getPath?: (name: 'userData') => string
  }
}

export function getUserDataPath() {
  try {
    const electron = require('electron') as ElectronAppModule
    const userDataPath = electron.app?.getPath?.('userData')
    if (userDataPath) return userDataPath
  } catch {
    // Node-only tests should not require a working Electron binary.
  }
  return path.join(os.tmpdir(), 'agent-token-tracker')
}
