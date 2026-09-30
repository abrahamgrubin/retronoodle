/** A mutation type's `apply()` throws this to reject cleanly with a specific HTTP status and
 * error code — the pipeline rolls back the transaction and returns it as-is. */
export class MutationRejected extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MutationRejected';
    this.status = status;
    this.code = code;
  }
}
