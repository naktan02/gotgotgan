import { cp, mkdir } from 'node:fs/promises'

const source = new URL('../src/adapters/browser/electron/control/', import.meta.url)
const destination = new URL('../dist/adapters/browser/electron/control/', import.meta.url)
await mkdir(destination, { recursive: true })
for (const file of ['index.html', 'style.css', 'main.js', 'preload.cjs']) {
  await cp(new URL(file, source), new URL(file, destination))
}
