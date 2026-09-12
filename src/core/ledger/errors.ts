/** Thrown when an idempotencyKey is reused with a materially different request. */
export class IdempotencyConflictError extends Error {
  readonly status = 409;

  constructor(idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was already used to post a different entry`);
    this.name = "IdempotencyConflictError";
  }
}
