import { QueueFullError } from './errors.js'

interface Task {
  state: 'waiting' | 'running' | 'settled'
  start(): Promise<void>
}

export class Queue {
  readonly #maxPending: number
  readonly #onIdle: () => void
  readonly #waiting: Task[] = []
  #current: Task | undefined

  constructor(maxPending: number, onIdle: () => void) {
    this.#maxPending = maxPending
    this.#onIdle = onIdle
  }

  enqueue<Result>(invoke: () => Result, signal?: AbortSignal): Promise<Awaited<Result>> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason)
    }

    if (this.#current && this.#waiting.length >= this.#maxPending) {
      return Promise.reject(new QueueFullError())
    }

    return new Promise((resolve, reject) => {
      let listening = false

      function detach(): void {
        if (signal && listening) {
          listening = false
          signal.removeEventListener('abort', abort)
        }
      }

      const cancel = (reason: unknown) => {
        if (task.state !== 'waiting') {
          return
        }

        this.#finish(task)

        try {
          detach()
        } finally {
          reject(reason)
        }
      }

      function abort(): void {
        cancel(signal?.reason)
      }

      const task: Task = {
        state: 'waiting',
        start: async () => {
          if (task.state !== 'waiting') {
            return
          }

          try {
            if (signal?.aborted) {
              cancel(signal.reason)
              return
            }

            task.state = 'running'
            detach()
            const result = await invoke()
            this.#finish(task)
            resolve(result)
          } catch (error) {
            this.#finish(task)
            reject(error)
          }
        },
      }

      if (this.#current) {
        this.#waiting.push(task)
      } else {
        this.#current = task
      }

      if (signal) {
        try {
          listening = true
          signal.addEventListener('abort', abort, { once: true })

          if (signal.aborted) {
            cancel(signal.reason)
          }
        } catch (error) {
          cancel(error)
        }
      }

      if (this.#current === task && task.state === 'waiting') {
        queueMicrotask(() => void task.start())
      }
    })
  }

  #finish(task: Task): void {
    if (task.state === 'settled') {
      return
    }

    task.state = 'settled'

    if (this.#current !== task) {
      this.#waiting.splice(this.#waiting.indexOf(task), 1)
      return
    }

    const next = this.#waiting.shift()
    this.#current = next

    if (next) {
      queueMicrotask(() => void next.start())
    } else {
      this.#onIdle()
    }
  }
}
