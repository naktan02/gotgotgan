import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

describe('Desktop count-only control view', () => {
  it('ignores repeated collect clicks without dropping the active result', async () => {
    const listeners = new Map<string, () => Promise<void>>()
    const elements = new Map(['status', 'collect', 'cancel'].map((id) => [id, {
      textContent: '', disabled: false,
      addEventListener: (_event: string, callback: () => Promise<void>) => listeners.set(id, callback),
    }]))
    let complete!: (result: unknown) => void
    const collect = vi.fn(() => new Promise((resolve) => { complete = resolve }))
    runInNewContext(await readFile(new URL('../control/main.js', import.meta.url), 'utf8'), {
      document: { getElementById: (id: string) => elements.get(id) },
      window: { gotgotganDesktop: { collect, cancel: vi.fn() } },
    })
    const running = listeners.get('collect')!()
    await listeners.get('collect')!()
    expect(collect).toHaveBeenCalledOnce()
    expect(elements.get('collect')!.disabled).toBe(true)
    complete({ state: 'collected', summary: { listCount: 1, itemCount: 2, missingIdentityCount: 0 } })
    await running
    expect(elements.get('status')!.textContent).toContain('1개 목록 · 2개 장소')
    expect(elements.get('collect')!.disabled).toBe(false)
  })
})
