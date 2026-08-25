import { access, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const repositoryRoot = process.cwd()
const ignoredDirectories = new Set(['.git', '.next', 'dist', 'node_modules', 'playwright-report', 'test-results'])

async function markdownFiles(directory) {
  const result = []
  for (const entry of await readdir(directory)) {
    if (ignoredDirectories.has(entry)) continue
    const target = path.join(directory, entry)
    if ((await stat(target)).isDirectory()) result.push(...await markdownFiles(target))
    else if (entry.endsWith('.md')) result.push(target)
  }
  return result
}

const failures = []
for (const file of await markdownFiles(repositoryRoot)) {
  const source = await readFile(file, 'utf8')
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].replace(/^<|>$/g, '')
    if (/^(?:https?:|mailto:|#)/.test(rawTarget)) continue
    const localTarget = decodeURIComponent(rawTarget.split('#')[0])
    const resolved = path.resolve(path.dirname(file), localTarget)
    try {
      await access(resolved)
    } catch {
      failures.push(`${path.relative(repositoryRoot, file)} -> ${rawTarget}`)
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`Broken local documentation links:\n${failures.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('Local documentation links are valid.\n')
