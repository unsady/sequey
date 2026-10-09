export class QueueFullError extends Error {
  constructor() {
    super('The pending queue is full')
    this.name = 'QueueFullError'
  }
}
