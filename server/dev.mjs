/**
 * Resolve `tsx` from server/node_modules (or parent node_modules if present).
 * Use: node dev.mjs   (same as: tsx watch src/index.ts)
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = dirname(fileURLToPath(import.meta.url))
const candidates = [
  join(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  join(serverRoot, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
]

const cli = candidates.find((p) => existsSync(p))
if (!cli) {
  console.error('tsx not found. From the server/ folder run: npm install')
  process.exit(1)
}

const child = spawn(process.execPath, [cli, 'watch', 'src/index.ts'], {
  stdio: 'inherit',
  cwd: serverRoot,
  shell: false,
})
child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 0)
})
