const { spawn } = require('child_process')

const DEFAULT_RENDERER_URL = 'http://localhost:3002'
const RENDERER_URL = (process.env.ELECTRON_RENDERER_URL || DEFAULT_RENDERER_URL).replace(/\/+$/, '')
const MAX_WAIT = 30000
const CHECK_INTERVAL = 500

async function waitForVite() {
  const startTime = Date.now()

  console.log(`[Electron] Waiting for Vite server at ${RENDERER_URL}...`)

  while (Date.now() - startTime < MAX_WAIT) {
    try {
      const response = await fetch(RENDERER_URL, { method: 'HEAD' })
      if (response.ok) {
        console.log('[Electron] Vite server is ready!')
        return true
      }
    } catch {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL))
  }

  console.error(`[Electron] Timeout waiting for Vite server at ${RENDERER_URL}`)
  return false
}

async function main() {
  const ready = await waitForVite()
  if (!ready) {
    process.exit(1)
  }

  console.log('[Electron] Starting Electron...')

  const electron = spawn('npx', ['electron', 'src/main.js'], {
    stdio: 'inherit',
    shell: true,
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: RENDERER_URL
    }
  })

  electron.on('close', (code) => {
    process.exit(code || 0)
  })
}

main()
