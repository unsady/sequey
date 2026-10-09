# Changelog

## [0.1.0] - 2026-10-09

### Added

- `serialize` for FIFO execution of function calls sharing a key, with independent keys running concurrently.
- Property, computed, and composite key selectors with TypeScript types.
- Per-key pending queue limits with `maxPending` and `QueueFullError`.
- Cancellation of calls before execution using `AbortSignal`, with automatic, custom, or disabled signal detection.
