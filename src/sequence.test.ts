import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { sequence, QueueFullError } from './index.js'
import type { CompositeKey, Key } from './index.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

describe('sequence', () => {
  it('runs different operations with matching keys in FIFO order while other keys run independently', async () => {
    const gate = deferred()
    const started: number[] = []
    const run = sequence()
    const first = run(
      async () => {
        started.push(1)
        await gate.promise

        return 1
      },
      { key: 'a' },
    )
    const second = run(
      () => {
        started.push(2)

        return 'saved'
      },
      { key: 'a' },
    )
    const third = run(
      () => {
        started.push(3)

        return true
      },
      { key: 'a' },
    )
    const independent = run(
      () => {
        started.push(4)

        return 4
      },
      { key: 'b' },
    )

    expect(await independent).toBe(4)
    expect(started).toEqual([1, 4])

    gate.resolve()

    expect(await Promise.all([first, second, third])).toEqual([1, 'saved', true])
    expect(started).toEqual([1, 4, 2, 3])
    expect(await run(() => 5, { key: 'a' })).toBe(5)
    expectTypeOf(first).toEqualTypeOf<Promise<number>>()
    expectTypeOf(second).toEqualTypeOf<Promise<string>>()
    expectTypeOf(third).toEqualTypeOf<Promise<boolean>>()
  })

  it.each(['a', 0, Symbol('key'), ['workspace', 'chat'] as const])(
    'accepts the shorthand key %s and shares its queue with the options form',
    async (key) => {
      const gate = deferred()
      const entered = deferred()
      const run = sequence()
      const first = run(async ({ signal }) => {
        expect(signal).toBeUndefined()
        entered.resolve()
        await gate.promise

        return 'first'
      }, key)
      const nextOperation = vi.fn<() => number>(() => 42)
      const next = run(nextOperation, { key })

      await entered.promise
      expect(nextOperation).not.toHaveBeenCalled()

      gate.resolve()

      await expect(first).resolves.toBe('first')
      await expect(next).resolves.toBe(42)
      expectTypeOf(first).toEqualTypeOf<Promise<string>>()
      await expect(run(() => true, key)).resolves.toBe(true)
    },
  )

  it('passes undefined in the context when no signal is supplied', async () => {
    const run = sequence()

    await run(
      ({ signal }) => {
        expectTypeOf(signal).toEqualTypeOf<AbortSignal | undefined>()
        expect(signal).toBeUndefined()
      },
      { key: 'a' },
    )
  })

  it('lets a running operation handle cancellation through its context', async () => {
    const run = sequence()
    const controller = new AbortController()
    const entered = deferred()
    const reason = new Error('cancelled')
    const result = run(
      ({ signal }) => {
        expect(signal).toBe(controller.signal)
        entered.resolve()

        return new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
      { key: 'a', signal: controller.signal },
    )
    const next = run(() => 42, { key: 'a' })

    await entered.promise
    controller.abort(reason)

    await expect(result).rejects.toBe(reason)
    await expect(next).resolves.toBe(42)
  })

  it('serializes operations without a key in an independent default queue', async () => {
    const gate = deferred()
    const started: number[] = []
    const run = sequence()
    const other = sequence()
    const first = run(async ({ signal }) => {
      expect(signal).toBeUndefined()
      started.push(1)
      await gate.promise

      return 1
    })
    const second = run(() => {
      started.push(2)

      return 2
    }, undefined)
    const third = run(() => {
      started.push(3)

      return 3
    })

    await expect(run(() => 42, 'explicit')).resolves.toBe(42)
    await expect(other(() => 7)).resolves.toBe(7)
    expect(started).toEqual([1])

    gate.resolve()

    expect(await Promise.all([first, second, third])).toEqual([1, 2, 3])
    expect(started).toEqual([1, 2, 3])
    await expect(run(() => 'done')).resolves.toBe('done')
    expectTypeOf(first).toEqualTypeOf<Promise<number>>()
  })

  it('applies pending limits to the default queue', async () => {
    const gate = deferred()
    const run = sequence({ maxPending: 0 })
    const first = run(() => gate.promise)
    const rejected = vi.fn<() => void>()

    await expect(run(rejected)).rejects.toBeInstanceOf(QueueFullError)
    expect(rejected).not.toHaveBeenCalled()

    gate.resolve()
    await first
    await expect(run(() => 42)).resolves.toBe(42)
  })

  it('keeps sequencer instances independent', async () => {
    const gate = deferred()
    const run = sequence()
    const other = sequence()
    const first = run(() => gate.promise, { key: 'a' })

    await expect(other(() => 42, { key: 'a' })).resolves.toBe(42)

    gate.resolve()
    await first
  })

  it.each(['throw', 'reject'] as const)('continues after an operation %s', async (mode) => {
    const error = new Error('failure')
    const run = sequence()
    const failed = run(
      () => {
        if (mode === 'throw') {
          throw error
        }

        return Promise.reject(error)
      },
      { key: 'a' },
    )
    const next = run(() => 42, { key: 'a' })

    await expect(failed).rejects.toBe(error)
    await expect(next).resolves.toBe(42)
  })

  it('limits waiting operations per key without counting the current operation', async () => {
    const gate = deferred()
    const invoke = vi.fn<() => Promise<number>>(async () => {
      await gate.promise

      return 42
    })
    const run = sequence({ maxPending: 1 })
    const first = run(invoke, { key: 'a' })
    const second = run(invoke, { key: 'a' })
    const rejected = vi.fn<() => void>()

    await expect(run(rejected, { key: 'a' })).rejects.toBeInstanceOf(QueueFullError)
    expect(rejected).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledTimes(1)
    await expect(run(() => 7, { key: 'b' })).resolves.toBe(7)

    gate.resolve()

    expect(await Promise.all([first, second])).toEqual([42, 42])
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('allows only the current operation when maxPending is zero', async () => {
    const gate = deferred()
    const invoke = vi.fn<() => Promise<void>>(() => gate.promise)
    const run = sequence({ maxPending: 0 })
    const first = run(invoke, { key: 'a' })

    await expect(run(invoke, { key: 'a' })).rejects.toBeInstanceOf(QueueFullError)

    gate.resolve()
    await first
    await run(invoke, { key: 'a' })

    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('rejects an already aborted operation with its reason without invoking it', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const invoke = vi.fn<() => number>(() => 42)
    const run = sequence()

    controller.abort(reason)

    await expect(run(invoke, { key: 'a', signal: controller.signal })).rejects.toBe(reason)
    expect(invoke).not.toHaveBeenCalled()
    await expect(run(invoke, { key: 'a' })).resolves.toBe(42)
  })

  it('removes an aborted waiting operation and frees its pending slot', async () => {
    const gate = deferred()
    const started: number[] = []
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const run = sequence({ maxPending: 1 })
    const first = run(
      async () => {
        started.push(1)
        await gate.promise

        return 1
      },
      { key: 'a' },
    )
    const cancelledOperation = vi.fn<() => number>(() => 2)
    const cancelled = run(cancelledOperation, { key: 'a', signal: controller.signal })

    controller.abort(reason)
    await expect(cancelled).rejects.toBe(reason)

    const next = run(
      () => {
        started.push(3)

        return 3
      },
      { key: 'a' },
    )

    expect(started).toEqual([1])

    gate.resolve()

    expect(await Promise.all([first, next])).toEqual([1, 3])
    expect(started).toEqual([1, 3])
    expect(cancelledOperation).not.toHaveBeenCalled()
  })

  it('does not interrupt a running operation or advance its queue on abort', async () => {
    const gate = deferred()
    const entered = deferred()
    const controller = new AbortController()
    const started: number[] = []
    const run = sequence()
    const first = run(
      async () => {
        started.push(1)
        entered.resolve()
        await gate.promise

        return 1
      },
      { key: 'a', signal: controller.signal },
    )
    const next = run(
      () => {
        started.push(2)

        return 2
      },
      { key: 'a' },
    )

    await entered.promise
    controller.abort(new Error('cancelled'))
    await Promise.resolve()

    expect(started).toEqual([1])

    gate.resolve()

    expect(await Promise.all([first, next])).toEqual([1, 2])
  })

  const symbol = Symbol('key')
  const keys: {
    name: string
    first: Key | CompositeKey
    matching: Key | CompositeKey
    distinct: Key | CompositeKey
  }[] = [
    { name: 'string', first: 'a', matching: 'a', distinct: 'b' },
    { name: 'number', first: 1, matching: 1, distinct: '1' },
    { name: 'symbol', first: symbol, matching: symbol, distinct: Symbol('key') },
    { name: 'composite values', first: ['ab', 'c'], matching: ['ab', 'c'], distinct: ['a', 'bc'] },
    { name: 'composite prefix', first: ['a'], matching: ['a'], distinct: ['a', 'b'] },
    { name: 'scalar and composite string', first: 'a', matching: 'a', distinct: ['a'] },
    { name: 'scalar and composite number', first: 1, matching: 1, distinct: [1] },
    { name: 'scalar and composite symbol', first: [symbol], matching: [symbol], distinct: symbol },
    { name: 'composite length', first: ['a', 'b'], matching: ['a', 'b'], distinct: ['a'] },
  ]

  it.each(keys)(
    'selects queues by $name without key collisions',
    async ({ first, matching, distinct }) => {
      const gate = deferred()
      const started: number[] = []
      const run = sequence()
      const current = run(
        async () => {
          started.push(1)
          await gate.promise

          return 1
        },
        { key: first },
      )
      const queued = run(
        () => {
          started.push(2)

          return 2
        },
        { key: matching },
      )
      const independent = run(
        () => {
          started.push(3)

          return 3
        },
        { key: distinct },
      )

      await expect(independent).resolves.toBe(3)
      expect(started).toEqual([1, 3])

      gate.resolve()

      expect(await Promise.all([current, queued])).toEqual([1, 2])
      expect(started).toEqual([1, 3, 2])
      await expect(run(() => 4, { key: first })).resolves.toBe(4)
    },
  )

  it.each([0, 1, Infinity])('accepts maxPending=%s', async (maxPending) => {
    const run = sequence({ maxPending })

    await expect(run(() => 42, { key: 'a' })).resolves.toBe(42)
  })

  it.each([-1, 0.5, NaN, -Infinity])(
    'rejects invalid maxPending=%s synchronously',
    (maxPending) => {
      expect(() => sequence({ maxPending })).toThrow(RangeError)
    },
  )
})
