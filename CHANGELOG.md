# Changelog

## [0.3.0] - 2026-10-11

### Changed

- **Breaking:** Rename `createSequencer` to `sequence`.

## [0.2.0] - 2026-10-11

### Added

- A default queue for operations called without a key.
- Operation callbacks receive a context containing the explicitly supplied abort signal.

### Changed

- **Breaking:** Replace `serialize` with `createSequencer`. Create a sequencer once, then pass an operation callback and an explicit scalar or composite key to each call. Different callbacks can share the same queues.
- **Breaking:** Replace property and computed key selectors with explicit keys, and automatic or custom signal detection with the `signal` option on each call.
- **Breaking:** Replace `KeyField`, `KeySelector`, `Serialized`, `SerializeOptions`, and `SignalSelector` with `CompositeKey`, `OperationContext`, `RunOptions`, `Sequencer`, and `SequencerOptions`.

## [0.1.0] - 2026-10-09

### Added

- `serialize` for FIFO execution of function calls sharing a key, with independent keys running concurrently.
- Property, computed, and composite key selectors with TypeScript types.
- Per-key pending queue limits with `maxPending` and `QueueFullError`.
- Cancellation of calls before execution using `AbortSignal`, with automatic, custom, or disabled signal detection.
