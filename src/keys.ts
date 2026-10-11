import { Queue } from './queue.js'
import type { Key } from './types.js'

interface Entry {
  children: Map<Key, Entry>
  queue: Queue | undefined
}

export function createQueues(maxPending: number) {
  const root: Entry = { children: new Map(), queue: undefined }

  return (keys: readonly Key[]): Queue => {
    let entry = root
    const path: { parent: Entry; key: Key; entry: Entry }[] = []

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
