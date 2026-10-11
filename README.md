# Sequey

## Installation

```sh
npm install sequey
```

## Usage

```ts
import { writeFile } from 'node:fs/promises'

import { createSequencer } from 'sequey'

interface Chat {
  id: string
  content: string
}

async function saveChat(
  chat: Chat,
  options: { signal?: AbortSignal | undefined } = {},
): Promise<void> {
  await writeFile(`./${chat.id}.txt`, chat.content, options)
}

const run = createSequencer()

await Promise.all([
  run(() => saveChat({ id: '1', content: 'first' }), '1'),
  run(() => saveChat({ id: '1', content: 'second' }), '1'),
  run(() => saveChat({ id: '2', content: 'independent' }), '2'),
])
```

Operations with the same key run one at a time in FIFO order. Different keys can run concurrently. Pass a callback so the operation starts only when its turn arrives. Each call returns a promise with its operation's result or error; a failed operation does not block the queue.

Create a sequencer once for the operations that need to share queues. Each sequencer has independent queues, and different callbacks can share the same key:

```ts
import { unlink } from 'node:fs/promises'

const chat = { id: '1', content: 'hello' }

const saved = run(() => saveChat(chat), { key: chat.id })
const deleted = run(() => unlink(`./${chat.id}.txt`), { key: chat.id })

await Promise.all([saved, deleted])
```

## Keys

Omit the second argument to serialize all unkeyed operations in one default queue:

```ts
await Promise.all([run(() => saveChat(firstChat)), run(() => saveChat(secondChat))])
```

The default queue belongs to its sequencer instance and is independent of explicitly keyed queues. Passing `undefined` as the second argument also selects the default queue. Pending limits apply to it as well.

Keys can be strings, numbers, or symbols. String and number keys are distinct; symbols match by identity.

Pass the key directly as the second argument, or use an options object when you need a signal. Both forms share the same queues:

```ts
await run(() => saveChat(chat), chat.id)
await run(() => saveChat(chat), { key: chat.id })
```

For composite keys, use a nonempty array:

```ts
await run(() => saveChat(chat), [workspaceId, chat.id])
await run(() => saveChat(chat), { key: [workspaceId, chat.id] })
```

Composite keys match by their elements and order, not the array's identity. Scalar and composite keys use separate queues: `'1'` and `['1']` are distinct keys.

## Max pending

```ts
const run = createSequencer({ maxPending: 100 })
```

`maxPending` allows up to 100 waiting operations per key, excluding the current operation. Additional operations reject with `QueueFullError` without invoking their callbacks. By default, `maxPending` is `Infinity`.

### Handling a full queue

```ts
import { QueueFullError } from 'sequey'

try {
  await run(() => saveChat(chat), { key: chat.id })
} catch (error) {
  if (error instanceof QueueFullError) {
    console.error('Too many waiting writes')
  } else {
    throw error
  }
}
```

## Cancellation

Pass an abort signal in the options object as the second argument. The callback receives a context object with the same signal, which you can forward to the operation:

```ts
const controller = new AbortController()
const result = run(({ signal }) => saveChat(chat, { signal }), {
  key: chat.id,
  signal: controller.signal,
})

controller.abort()

try {
  await result
} catch (error) {
  console.error(error)
}
```

Aborting an operation before it starts removes it from the queue, frees its pending slot, and rejects with `signal.reason`. Already aborted signals reject without invoking the callback. Running operations are not interrupted by Sequey; the operation itself must handle cancellation. Without a signal in the options, the callback's context contains `signal: undefined`. Callbacks that do not need the context can ignore it.

## License

[Apache-2.0](./LICENSE).
