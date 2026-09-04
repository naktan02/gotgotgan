import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const layoutSourcePattern = /\.(?:css|ts|tsx)$/
const testSourcePattern = /\.(?:test|spec)\.(?:css|ts|tsx)$/

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function isProductionLayoutSource(name) {
  return layoutSourcePattern.test(name) && !name.endsWith('.d.ts') && !testSourcePattern.test(name)
}

function isTestSupportDirectory(name) {
  return name === 'tests' || name === '__tests__'
}

export async function inspectFrontendLayout(root) {
  const violations = []

  async function inspectDirectory(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    const directSources = entries.filter(
      (entry) => entry.isFile() && isProductionLayoutSource(entry.name),
    )
    const relativeDirectory = normalize(path.relative(root, directory)) || '.'
    if (directSources.length > 12) {
      violations.push(
        `${relativeDirectory}: ${directSources.length} direct production sources exceed the 12-file layout review gate`,
      )
    }
    for (const entry of directSources) {
      const target = path.join(directory, entry.name)
      const contents = await readFile(target, 'utf8')
      if (contents.split(/\r?\n/).length > 500) {
        violations.push(
          `${normalize(path.relative(root, target))}: production source exceeds the 500-line layout review gate`,
        )
      }
    }
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !isTestSupportDirectory(entry.name))
      .map((entry) => inspectDirectory(path.join(directory, entry.name))))
  }

  await inspectDirectory(root)
  return violations
}
