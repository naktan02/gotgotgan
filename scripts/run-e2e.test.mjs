import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

function fixture(t) {
  const parent = mkdtempSync(path.join(tmpdir(), 'place-e2e-launcher-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const root = path.join(parent, 'source')
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  copyFileSync(new URL('./run-e2e.mjs', import.meta.url), path.join(root, 'scripts/run-e2e.mjs'))
  for (const directory of ['apps/web/.next', 'apps/admin-web/.next']) {
    mkdirSync(path.join(root, directory), { recursive: true })
    writeFileSync(path.join(root, directory, 'sentinel'), 'owned build output')
  }
  const run = (disposable) => spawnSync(process.execPath, ['scripts/run-e2e.mjs'], {
    cwd: root,
    env: { ...process.env, PLACE_WEB_E2E_BASE_URL: 'http://127.0.0.1:4177',
      PLACE_E2E_DISPOSABLE_WORKSPACE: disposable },
    encoding: 'utf8', timeout: 10_000,
  })
  return { parent, root, run }
}

test('normal development preserves existing build outputs', (t) => {
  const { root, run } = fixture(t)
  const result = run('false')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ENOENT/)
  assert.equal(readFileSync(path.join(root, 'apps/admin-web/.next/sentinel'), 'utf8'), 'owned build output')
  assert.equal(readFileSync(path.join(root, 'apps/web/.next/sentinel'), 'utf8'), 'owned build output')
})

test('disposable CI removes only the two canonical build outputs', (t) => {
  const { root, run } = fixture(t)
  const result = run('true')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ENOENT/)
  assert.equal(existsSync(path.join(root, 'apps/web/.next')), false)
  assert.equal(existsSync(path.join(root, 'apps/admin-web/.next')), false)
  assert.equal(existsSync(path.join(root, 'scripts/run-e2e.mjs')), true)
})

for (const internal of [false, true]) {
  test(`disposable CI rejects a build output redirected ${internal ? 'inside' : 'outside'} the workspace`, (t) => {
    const { parent, root, run } = fixture(t)
    const target = path.join(internal ? root : parent, 'unique-source')
    mkdirSync(target)
    writeFileSync(path.join(target, 'sentinel'), 'must survive')
    const output = path.join(root, 'apps/admin-web/.next')
    rmSync(output, { recursive: true })
    symlinkSync(target, output, process.platform === 'win32' ? 'junction' : 'dir')
    const result = run('true')
    assert.equal(result.status, 1)
    assert.match(result.stderr, internal ? /CI build output path is redirected/ : /CI build output leaves the disposable workspace/)
    assert.equal(readFileSync(path.join(target, 'sentinel'), 'utf8'), 'must survive')
  })
}
