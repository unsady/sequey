export type Key = string | number | symbol

export type KeyField<Args extends unknown[]> = {
  [Field in keyof Args[0]]-?: Args[0][Field] extends Key ? Field : never
}[keyof Args[0]] &
  string

export type KeySelector<Args extends unknown[]> =
  | KeyField<Args>
  | readonly [KeyField<Args>, ...KeyField<Args>[]]
  | ((...args: Args) => Key)

export type SignalSelector<Args extends unknown[]> =
  | boolean
  | ((...args: Args) => AbortSignal | undefined)

export interface SerializeOptions<Args extends unknown[]> {
  by: KeySelector<Args>
  maxPending?: number
  signal?: SignalSelector<Args>
}

export type Serialized<Args extends unknown[], Result> = (...args: Args) => Promise<Awaited<Result>>
