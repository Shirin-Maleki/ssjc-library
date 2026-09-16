/**
 * Domain-level failures for Reading List mutations — Phase 4 correction pass. The
 * point of these is that a Server Action/repository caller can reason about "this
 * list doesn't exist" or "this book doesn't exist" as a normal, expected outcome,
 * never a raw Postgres foreign-key-violation or invalid-UUID-syntax exception. The
 * teacher-facing UI still shows its existing single generic calm message regardless
 * of which of these was thrown (`AddToReadingListDialog`, etc.) — these types exist
 * for the server-side contract, not to add new UI copy.
 */
export class ReadingListNotFoundError extends Error {
  constructor(id: string) {
    super(`Reading list ${id} not found.`);
    this.name = "ReadingListNotFoundError";
  }
}

export class BookNotFoundError extends Error {
  constructor(id: string) {
    super(`Book ${id} not found.`);
    this.name = "BookNotFoundError";
  }
}

export class InvalidIdError extends Error {
  constructor(id: string) {
    super(`"${id}" is not a valid id.`);
    this.name = "InvalidIdError";
  }
}
