#!/usr/bin/env node

const { spawn } = require('node:child_process')
const path = require('node:path')

let electron
try {
  electron = require('electron')
} catch {
  console.error('Electron runtime not found. Please reinstall agent-token-tracker.')
  process.exit(1)
}

const mainPath = path.join(__dirname, '..', 'dist-electron', 'main.js')
const child = spawn(electron, [mainPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: false,
})

child.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
