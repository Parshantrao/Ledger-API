/**
 * The single application error type. It carries an HTTP status, a stable machine-readable
 * code, and a message that is safe to show to API clients.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static accountNotFound(message = 'Account not found.'): AppError {
    return new AppError(404, 'ACCOUNT_NOT_FOUND', message);
  }

  static insufficientBalance(): AppError {
    return new AppError(409, 'INSUFFICIENT_BALANCE', 'The account has insufficient funds.');
  }

  static duplicateReference(): AppError {
    return new AppError(
      409,
      'DUPLICATE_REFERENCE',
      'A transaction with this reference ID already exists for the account.',
    );
  }
}
