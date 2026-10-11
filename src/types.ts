export type Key = string | number | symbol

export type CompositeKey = readonly [Key, ...Key[]]

export interface SequencerOptions {
  maxPending?: number
}

export interface RunOptions {
  key: Key | CompositeKey
  signal?: AbortSignal
}

export interface OperationContext {
  signal: AbortSignal | undefined
}

export type Sequencer = <Result>(
  operation: (context: OperationContext) => Result,
  options?: Key | CompositeKey | RunOptions,
) => Promise<Awaited<Result>>
