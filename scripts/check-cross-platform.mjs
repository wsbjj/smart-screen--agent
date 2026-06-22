import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

const packageJson = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'))

const scriptChecks = [
  {
    name: 'POSIX-style environment assignment in npm script',
    pattern: /(^|&&|\|\||;)\s*[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+\S/,
  },
  {
    name: 'Unix-only rm command in npm script',
    pattern: /(^|&&|\|\||;)\s*rm\s+-/,
  },
  {
    name: 'Unix-only cp command in npm script',
    pattern: /(^|&&|\|\||;)\s*cp\s+/,
  },
  {
    name: 'Unix-only mkdir -p command in npm script',
    pattern: /(^|&&|\|\||;)\s*mkdir\s+-p\b/,
  },
  {
    name: 'Unix-only export command in npm script',
    pattern: /(^|&&|\|\||;)\s*export\s+[A-Za-z_]/,
  },
]

for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  for (const check of scriptChecks) {
    if (check.pattern.test(command)) {
      failures.push(`package.json script "${name}" uses ${check.name}: ${command}`)
    }
  }
}

const codeExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const codeRoots = ['electron', 'scripts', 'src']
const ignoredFiles = new Set(['scripts/check-cross-platform.mjs'])

const codeChecks = [
  {
    name: 'direct named import from electron in native ESM',
    pattern: /import\s+\{[^}]+\}\s+from\s+['"]electron['"]/,
  },
  {
    name: 'hard-coded macOS user path',
    pattern: /['"]\/Users\//,
  },
  {
    name: 'hard-coded Windows drive path',
    pattern: /['"][A-Za-z]:[\\/]/,
  },
  {
    name: 'hard-coded temporary directory',
    pattern: /['"]\/tmp[\\/]/,
  },
]

for (const codeRoot of codeRoots) {
  await scanDirectory(join(rootDir, codeRoot))
}

if (failures.length > 0) {
  console.error('Cross-platform compatibility check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Cross-platform compatibility check passed.')

async function scanDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(directory, entry.name)
    const projectPath = relative(rootDir, fullPath).replaceAll('\\', '/')

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') {
        continue
      }
      await scanDirectory(fullPath)
      continue
    }

    if (!entry.isFile() || !codeExtensions.has(extname(entry.name)) || ignoredFiles.has(projectPath)) {
      continue
    }

    const source = await readFile(fullPath, 'utf8')
    for (const check of codeChecks) {
      if (check.pattern.test(source)) {
        failures.push(`${projectPath} contains ${check.name}`)
      }
    }
  }
}

