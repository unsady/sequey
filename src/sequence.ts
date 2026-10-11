import { createQueues } from './keys.js'
import type { Sequencer, SequencerOptions } from './types.js'
import { validateMaxPending } from './validation.js'

export function sequence(options: SequencerOptions = {}): Sequencer {
  const maxPending = options.maxPending === undefined ? Infinity : options.maxPending

  validateMaxPending(maxPending)

  const getScalarQueue = createQueues(maxPending)
  const getCompositeQueue = createQueues(maxPending)
  const defaultKey = Symbol()

  return (operation, options = defaultKey) => {
    try {
      const { key, signal } =
        typeof options === 'object' && 'key' in options ? options : { key: options }

      if (signal?.aborted) {
        return Promise.reject(signal.reason)
      }

      const queue = typeof key === 'object' ? getCompositeQueue(key) : getScalarQueue([key])

      return queue.enqueue(() => operation({ signal }), signal)
    } catch (error) {
      return Promise.reject(error)
    }
  }
}
