import { createKeySelector, createQueues } from './keys.js'
import type { KeyField, Serialized, SerializeOptions, SignalSelector } from './types.js'
import { validateMaxPending } from './validation.js'

function createSignalSelector<Args extends unknown[]>(option: SignalSelector<Args> | undefined) {
  if (typeof option === 'function') {
    return option
  }

  if (option === false) {
    return (..._args: Args) => undefined
  }

  return (...args: Args) => {
    const signal: AbortSignal | undefined = Reflect.get(Object(args.at(-1)), 'signal')

    return signal
  }
}

export function serialize<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  selector: KeyField<Args> | SerializeOptions<Args>,
): Serialized<Args, Result> {
  const options = typeof selector === 'string' ? { by: selector } : selector
  const maxPending = options.maxPending === undefined ? Infinity : options.maxPending

  validateMaxPending(maxPending)

  const selectKeys = createKeySelector(options.by)
  const selectSignal = createSignalSelector(options.signal)
  const getQueue = createQueues(maxPending)

  return (...args) => {
    try {
      const keys = selectKeys(...args)
      const signal = selectSignal(...args)

      if (signal?.aborted) {
        return Promise.reject(signal.reason)
      }

      return getQueue(keys).enqueue(() => fn(...args), signal)
    } catch (error) {
      return Promise.reject(error)
    }
  }
}
