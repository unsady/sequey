export function validateMaxPending(maxPending: number): void {
  if (maxPending !== Infinity && (!Number.isInteger(maxPending) || maxPending < 0)) {
    throw new RangeError('maxPending must be a nonnegative integer or Infinity')
  }
}
