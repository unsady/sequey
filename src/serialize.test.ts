import { describe, expect, it, vi } from 'vitest'

import { QueueFullError, serialize } from './index.js'
import type { SerializeOptions } from './index.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

describe('serialize', () => {
  it('runs matching keys in FIFO order while other keys run independently', async () => {
    const gate = deferred()
    const started: number[] = []
    const run = serialize(async ({ id }: { key: string; id: number }) => {
      started.push(id)

      if (id === 1) {
        await gate.promise
      }

      return id
    }, 'key')

    const first = run({ key: 'a', id: 1 })
    const second = run({ key: 'a', id: 2 })
    const third = run({ key: 'a', id: 3 })
    const independent = run({ key: 'b', id: 4 })

    expect(await independent).toBe(4)
    expect(started).toEqual([1, 4])

    gate.resolve()

    expect(await Promise.all([first, second, third])).toEqual([1, 2, 3])
    expect(started).toEqual([1, 4, 2, 3])
    expect(await run({ key: 'a', id: 5 })).toBe(5)
  })

  it.each(['throw', 'reject'] as const)('continues after a function %s', async (mode) => {
    const error = new Error('failure')
    const run = serialize(({ key: _key, fail }: { key: string; fail: boolean }) => {
      if (fail) {
        if (mode === 'throw') {
          throw error
        }

        return Promise.reject(error)
      }

      return 42
    }, 'key')

    const failed = run({ key: 'a', fail: true })
    const next = run({ key: 'a', fail: false })

    await expect(failed).rejects.toBe(error)
    await expect(next).resolves.toBe(42)
  })

  it('limits waiting calls without counting the running call', async () => {
    const gate = deferred()
    const invoke = vi.fn<(input: { key: string }) => Promise<number>>(async (_input) => {
      await gate.promise

      return 42
    })
    const run = serialize(invoke, { by: 'key', maxPending: 1 })
    const first = run({ key: 'a' })
    const second = run({ key: 'a' })

    await expect(run({ key: 'a' })).rejects.toBeInstanceOf(QueueFullError)
    expect(invoke).toHaveBeenCalledTimes(1)

    gate.resolve()

    expect(await Promise.all([first, second])).toEqual([42, 42])
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('allows only the current call when maxPending is zero', async () => {
    const gate = deferred()
    const invoke = vi.fn<(input: { key: string }) => Promise<void>>(async (_input) => {
      await gate.promise
    })
    const run = serialize(invoke, { by: 'key', maxPending: 0 })
    const first = run({ key: 'a' })

    await expect(run({ key: 'a' })).rejects.toBeInstanceOf(QueueFullError)

    gate.resolve()
    await first
    await run({ key: 'a' })

    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('rejects an already aborted call with its reason without invoking it', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const invoke = vi.fn<(input: { key: string; signal?: AbortSignal }) => number>(() => 42)
    const run = serialize(invoke, 'key')

    controller.abort(reason)

    await expect(run({ key: 'a', signal: controller.signal })).rejects.toBe(reason)
    expect(invoke).not.toHaveBeenCalled()
    await expect(run({ key: 'a' })).resolves.toBe(42)
  })

  it('removes an aborted waiting call and frees its pending slot', async () => {
    const gate = deferred()
    const started: number[] = []
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const run = serialize(
      async ({ id }: { key: string; id: number; signal?: AbortSignal }) => {
        started.push(id)

        if (id === 1) {
          await gate.promise
        }

        return id
      },
      { by: 'key', maxPending: 1 },
    )
    const first = run({ key: 'a', id: 1 })
    const cancelled = run({ key: 'a', id: 2, signal: controller.signal })

    controller.abort(reason)
    await expect(cancelled).rejects.toBe(reason)

    const next = run({ key: 'a', id: 3 })

    expect(started).toEqual([1])

    gate.resolve()

    expect(await Promise.all([first, next])).toEqual([1, 3])
    expect(started).toEqual([1, 3])
  })

  it('does not interrupt a running call or advance its queue on abort', async () => {
    const gate = deferred()
    const entered = deferred()
    const controller = new AbortController()
    const started: number[] = []
    const run = serialize(async ({ id }: { key: string; id: number; signal?: AbortSignal }) => {
      started.push(id)

      if (id === 1) {
        entered.resolve()
        await gate.promise
      }

      return id
    }, 'key')
    const first = run({ key: 'a', id: 1, signal: controller.signal })
    const next = run({ key: 'a', id: 2 })

    await entered.promise
    controller.abort(new Error('cancelled'))
    await Promise.resolve()

    expect(started).toEqual([1])

    gate.resolve()

    expect(await Promise.all([first, next])).toEqual([1, 2])
  })

  interface Input {
    key: string
    left: string
    right: string
    id: number
  }

  const selectors: { name: string; by: SerializeOptions<[Input]>['by'] }[] = [
    { name: 'field', by: 'key' },
    { name: 'composite fields', by: ['left', 'right'] },
    { name: 'function', by: (input) => input.key },
  ]

  it.each(selectors)('selects queues by $name without key collisions', async ({ by }) => {
    const gate = deferred()
    const started: number[] = []
    const run = serialize(
      async ({ id }: Input) => {
        started.push(id)

        if (id === 1) {
          await gate.promise
        }

        return id
      },
      { by },
    )
    const input = { key: 'a', left: 'ab', right: 'c', id: 1 }
    const first = run(input)
    const matching = run({ ...input, id: 2 })
    const distinct = run({ key: 'b', left: 'a', right: 'bc', id: 3 })

    await expect(distinct).resolves.toBe(3)
    expect(started).toEqual([1, 3])

    gate.resolve()

    expect(await Promise.all([first, matching])).toEqual([1, 2])
    expect(started).toEqual([1, 3, 2])
  })

  it.each([undefined, true])(
    'reads the signal from the last argument with signal=%s',
    async (signal) => {
      const controller = new AbortController()
      const reason = new Error('cancelled')
      const invoke = vi.fn<(input: { key: string }, options: { signal: AbortSignal }) => number>(
        () => 42,
      )
      const options: SerializeOptions<Parameters<typeof invoke>> = { by: 'key' }

      if (signal !== undefined) {
        options.signal = signal
      }

      const run = serialize(invoke, options)

      controller.abort(reason)

      await expect(run({ key: 'a' }, { signal: controller.signal })).rejects.toBe(reason)
      expect(invoke).not.toHaveBeenCalled()
    },
  )

  it('ignores automatic signal detection when disabled', async () => {
    const controller = new AbortController()
    const run = serialize((_input: { key: string; signal: AbortSignal }) => 42, {
      by: 'key',
      signal: false,
    })

    controller.abort()

    await expect(run({ key: 'a', signal: controller.signal })).resolves.toBe(42)
  })

  it('uses a custom signal selector', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const invoke = vi.fn<(input: { key: string }, signal: AbortSignal) => number>(() => 42)
    const run = serialize(invoke, { by: 'key', signal: (_input, signal) => signal })

    controller.abort(reason)

    await expect(run({ key: 'a' }, controller.signal)).rejects.toBe(reason)
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([0, 1, Infinity])('accepts maxPending=%s', async (maxPending) => {
    const run = serialize((_input: { key: string }) => 42, { by: 'key', maxPending })

    await expect(run({ key: 'a' })).resolves.toBe(42)
  })

  it.each([-1, 0.5, NaN, -Infinity])(
    'rejects invalid maxPending=%s synchronously',
    (maxPending) => {
      expect(() => serialize((_input: { key: string }) => 42, { by: 'key', maxPending })).toThrow(
        RangeError,
      )
    },
  )
})
