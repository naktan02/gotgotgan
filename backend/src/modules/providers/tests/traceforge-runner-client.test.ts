import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const forge = vi.hoisted(() => ({ start: vi.fn() }))

vi.mock('@traceforge/runner-sdk', () => ({
  ForgeSdk: { start: forge.start },
}))

import {
  TraceForgeRunnerClient,
  type ForgeRecipeRequest,
  type ForgeRecipeResult,
} from '../index.js'

const roots: string[] = []
const request: ForgeRecipeRequest = {
  inputs: { 'place-id': '31806828' },
  packId: 'naver',
  packVersion: '0.1.0',
  recipeId: 'map-place-detail-dom',
  version: 1,
}
const success: ForgeRecipeResult = {
  outputs: { name: '검증 장소' },
  state: 'succeeded',
  version: 1,
}

async function profileRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'place-traceforge-test-'))
  roots.push(root)
  return root
}

function client(root: string): TraceForgeRunnerClient {
  return new TraceForgeRunnerClient({
    command: 'node-fixture',
    packFiles: ['C:\\fixture\\naver-pack.json'],
    profilePrefix: 'naver-anonymous-',
    profileRoot: root,
    runnerFile: 'C:\\fixture\\runner.js',
    startupTimeoutMilliseconds: 5_000,
  })
}

function profileFromStartCall(callIndex: number): string {
  const options = forge.start.mock.calls[callIndex]?.[0] as { arguments: readonly string[] }
  const profileFlag = options.arguments.indexOf('--profile-directory')
  const profile = options.arguments[profileFlag + 1]
  if (profile === undefined) throw new Error('Test Runner profile was not supplied.')
  return profile
}

afterEach(async () => {
  forge.start.mockReset()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('TraceForge Runner client', () => {
  it('reuses one SDK and anonymous profile for sequential runs', async () => {
    const root = await profileRoot()
    const sdk = {
      close: vi.fn(async () => undefined),
      run: vi.fn(async () => success),
    }
    forge.start.mockResolvedValue(sdk)
    const runner = client(root)

    await expect(runner.run(request, new AbortController().signal)).resolves.toEqual(success)
    await expect(runner.run(request, new AbortController().signal)).resolves.toEqual(success)

    expect(forge.start).toHaveBeenCalledOnce()
    expect(sdk.run).toHaveBeenCalledTimes(2)
    const options = forge.start.mock.calls[0]?.[0]
    expect(options).toMatchObject({
      command: 'node-fixture',
      startupTimeoutMs: 5_000,
    })
    expect(options.arguments).toEqual([
      'C:\\fixture\\runner.js',
      '--headless',
      'true',
      '--pack',
      'C:\\fixture\\naver-pack.json',
      '--profile-directory',
      expect.stringContaining('naver-anonymous-'),
    ])
    await expect(access(profileFromStartCall(0))).resolves.toBeUndefined()
    await runner.close()
  })

  it('closes the SDK, settles the aborted run, and restarts with a new profile', async () => {
    const root = await profileRoot()
    let rejectFirstRun: ((reason: Error) => void) | undefined
    const firstSdk = {
      close: vi.fn(async () => {
        await expect(access(profileFromStartCall(0))).resolves.toBeUndefined()
        rejectFirstRun?.(new Error('SDK closed'))
      }),
      run: vi.fn(async () => await new Promise<ForgeRecipeResult>((_resolve, reject) => {
        rejectFirstRun = reject
      })),
    }
    const secondSdk = {
      close: vi.fn(async () => undefined),
      run: vi.fn(async () => success),
    }
    forge.start
      .mockResolvedValueOnce(firstSdk)
      .mockResolvedValueOnce(secondSdk)
    const runner = client(root)
    const controller = new AbortController()

    const abortedRun = runner.run(request, controller.signal)
    await vi.waitFor(() => expect(firstSdk.run).toHaveBeenCalledOnce())
    controller.abort()

    await expect(abortedRun).rejects.toMatchObject({ name: 'AbortError' })
    expect(firstSdk.close).toHaveBeenCalledOnce()
    const firstProfile = profileFromStartCall(0)
    await expect(access(firstProfile)).rejects.toThrow()

    await expect(runner.run(request, new AbortController().signal)).resolves.toEqual(success)
    expect(forge.start).toHaveBeenCalledTimes(2)
    expect(profileFromStartCall(1)).not.toBe(firstProfile)
    await runner.close()
  })

  it('closes the SDK before deleting the profile and is idempotent', async () => {
    const root = await profileRoot()
    const sdk = {
      close: vi.fn(async () => {
        await expect(access(profileFromStartCall(0))).resolves.toBeUndefined()
      }),
      run: vi.fn(async () => success),
    }
    forge.start.mockResolvedValue(sdk)
    const runner = client(root)
    await runner.run(request, new AbortController().signal)
    const profile = profileFromStartCall(0)

    await Promise.all([runner.close(), runner.close()])

    expect(sdk.close).toHaveBeenCalledOnce()
    await expect(access(profile)).rejects.toThrow()
    await expect(runner.close()).resolves.toBeUndefined()
    expect(sdk.close).toHaveBeenCalledOnce()
  })

  it('discards a failed transport session before the next run', async () => {
    const root = await profileRoot()
    const firstSdk = {
      close: vi.fn(async () => undefined),
      run: vi.fn(async () => { throw new Error('transport closed') }),
    }
    const secondSdk = {
      close: vi.fn(async () => undefined),
      run: vi.fn(async () => success),
    }
    forge.start
      .mockResolvedValueOnce(firstSdk)
      .mockResolvedValueOnce(secondSdk)
    const runner = client(root)

    await expect(runner.run(request, new AbortController().signal))
      .rejects.toThrow('transport closed')
    expect(firstSdk.close).toHaveBeenCalledOnce()
    await expect(access(profileFromStartCall(0))).rejects.toThrow()

    await expect(runner.run(request, new AbortController().signal)).resolves.toEqual(success)
    expect(forge.start).toHaveBeenCalledTimes(2)
    await runner.close()
  })
})
