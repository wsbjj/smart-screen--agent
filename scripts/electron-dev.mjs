import { spawn } from 'node:child_process'
import electronPath from 'electron'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env,
})

let childClosed = false

child.on('close', (code, signal) => {
  childClosed = true
  if (code === null) {
    console.error(`${electronPath} exited with signal ${signal}`)
    process.exit(1)
  }
  process.exit(code)
})

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => {
    if (!childClosed) {
      child.kill(signal)
    }
  })
}
