import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'))

const packageVersion = packageJson.version
const refType = process.env.GITHUB_REF_TYPE
const rawTag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? ''
const tag = rawTag.replace(/^refs\/tags\//, '')

if (refType && refType !== 'tag') {
  console.log('No git tag context detected; release version check skipped.')
  process.exit(0)
}

if (!tag) {
  console.log('No git tag provided; release version check skipped.')
  process.exit(0)
}

if (tag !== packageVersion) {
  console.error(`Git tag "${tag}" must exactly match package.json version "${packageVersion}".`)
  console.error(`Use: git tag ${packageVersion}`)
  process.exit(1)
}

console.log(`Git tag "${tag}" matches package.json version "${packageVersion}".`)

