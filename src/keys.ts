import { Queue } from './queue.js'
import type { KeySelector } from './types.js'

interface Entry {
  children: Map<unknown, Entry>
  queue: Queue | undefined
}

export function createKeySelector<Args extends unknown[]>(by: KeySelector<Args>) {
  if (typeof by === 'function') {
    return (...args: Args) => [by(...args)]
  }

  const fields = typeof by === 'string' ? [by] : [...by]

  return (...args: Args) => {
    const first: Args[0] = args[0]

    return fields.map((field) => first[field])
  }
}

export function createQueues(maxPending: number) {
  const root: Entry = { children: new Map(), queue: undefined }

  return (keys: readonly unknown[]): Queue => {
    let entry = root
    const path: { parent: Entry; key: unknown; entry: Entry }[] = []

    for (const key of keys) {
      let child = entry.children.get(key)

      if (!child) {
        child = { children: new Map(), queue: undefined }
        entry.children.set(key, child)
      }

      path.push({ parent: entry, key, entry: child })
      entry = child
    }

    entry.queue ??= new Queue(maxPending, () => {
      entry.queue = undefined

      for (const item of path.reverse()) {
        if (item.entry.queue || item.entry.children.size > 0) {
          break
        }

        item.parent.children.delete(item.key)
      }
    })

    return entry.queue
  }
}
