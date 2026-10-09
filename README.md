# Sequey

## Installation

```sh
npm install sequey
```

## Usage

```ts
import { writeFile } from 'node:fs/promises'

import { serialize } from 'sequey'

interface Chat {
  id: string
  content: string
}

async function saveChat(chat: Chat): Promise<void> {
  await writeFile(`./${chat.id}.txt`, chat.content)
}

const save = serialize(saveChat, 'id')

await Promise.all([
  save({ id: '1', content: 'first' }),
  save({ id: '1', content: 'second' }),
  save({ id: '2', content: 'independent' }),
])
```

Calls with the same `id` run one at a time in order. Different IDs can run concurrently.

## Computed keys

```ts
const save = serialize(saveChat, {
  by: (chat) => chat.id,
})
```

The key extractor receives all original arguments.

## Composite keys

```ts
async function saveInWorkspace(chat: Chat & { workspaceId: string }): Promise<void> {
  await writeFile(`./${chat.workspaceId}-${chat.id}.txt`, chat.content)
}

const save = serialize(saveInWorkspace, {
  by: ['workspaceId', 'id'],
})
```

Calls share a queue when both `workspaceId` and `id` match.

## Max pending

```ts
const save = serialize(saveChat, {
  by: 'id',
  maxPending: 100,
})
```

`maxPending` allows up to 100 waiting calls per key, excluding the current call. Additional calls reject with `QueueFullError`. By default, `maxPending` is `Infinity`.

### Handling a full queue

```ts
import { QueueFullError } from 'sequey'

try {
  await save({ id: '1', content: 'hello' })
} catch (error) {
  if (error instanceof QueueFullError) {
    console.error('Too many waiting writes')
  } else {
    throw error
  }
}
```

## Cancellation

```ts
async function saveWithSignal(chat: Chat, _options: { signal: AbortSignal }): Promise<void> {
  await saveChat(chat)
}

const save = serialize(saveWithSignal, 'id')
const controller = new AbortController()
const result = save({ id: '1', content: 'hello' }, { signal: controller.signal })

controller.abort()

try {
  await result
} catch (error) {
  console.error(error)
}
```

By default, the signal is read from `.signal` on the last argument. Aborting a call before it starts removes it from the queue and rejects with `signal.reason`. Running calls are not interrupted by Sequey.

### Disabling signal detection

```ts
const save = serialize(saveWithSignal, {
  by: 'id',
  signal: false,
})
```

Sequey ignores signals supplied in the arguments.

## License

[Apache-2.0](./LICENSE).
