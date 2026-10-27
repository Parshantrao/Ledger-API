import type { ClientSession, Connection } from 'mongoose';
import { TRANSACTION_OPTIONS } from '../../config/database';
import { AppError } from '../../errors/AppError';
import type { IAccountRepository } from '../../interfaces/IAccountRepository';
import type { ITransactionRepository } from '../../interfaces/ITransactionRepository';
import type { Transaction } from './transaction.model';
import type { CreateTransactionInput, PaginationQuery } from './transaction.validator';

export interface TransactionResult {
  transaction: Transaction;
  /** Account balance after this transaction was applied. */
  balance: number;
}

export interface TransactionHistory {
  items: Transaction[];
  pagination: {
    currentPage: number;
    pageSize: number;
    totalRecords: number;
    totalPages: number;
  };
}

export class TransactionService {
  constructor(
    private readonly connection: Connection,
    private readonly accountRepository: IAccountRepository,
    private readonly transactionRepository: ITransactionRepository,
  ) {}

  /**
   * Applies a credit or debit atomically: the balance change and the ledger entry are written
   * in one MongoDB transaction, so either both persist or neither does.
   *
   * `withTransaction` commits only if the callback succeeds, aborts on any thrown error, and
   * retries the callback on TransientTransactionError (e.g. a write conflict with a concurrent
   * debit on the same account). Retrying is safe because an aborted attempt leaves no writes
   * behind, and the unique reference index prevents a second application.
   */
  async createTransaction(
    accountId: string,
    input: CreateTransactionInput,
  ): Promise<TransactionResult> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(
        () => this.applyTransaction(accountId, input, session),
        TRANSACTION_OPTIONS,
      );
    } finally {
      await session.endSession();
    }
  }

  /**
   * The steps of a single ledger entry. Must run inside a transaction on `session`; every
   * database call is awaited in sequence on that session (never Promise.all within a transaction).
   * Also used by TransferService for each leg of a transfer.
   */
  async applyTransaction(
    accountId: string,
    input: CreateTransactionInput,
    session: ClientSession,
  ): Promise<TransactionResult> {
    const account = await this.accountRepository.findById(accountId, session);
    if (!account) throw AppError.accountNotFound();

    // Checked first so a repeated request always gets the same DUPLICATE_REFERENCE answer,
    // even if, say, the balance has since dropped below the amount.
    if (await this.transactionRepository.existsByReference(accountId, input.referenceId, session)) {
      throw AppError.duplicateReference();
    }

    const updatedAccount =
      input.type === 'credit'
        ? await this.accountRepository.incrementBalance(accountId, input.amount, session)
        : await this.accountRepository.decrementBalanceIfSufficient(
            accountId,
            input.amount,
            session,
          );
    // The account was found above in this same transaction, so null here means the
    // balance condition failed rather than the account being missing.
    if (!updatedAccount) throw AppError.insufficientBalance();

    const transaction = await this.transactionRepository.create(
      {
        accountId,
        type: input.type,
        amount: input.amount,
        description: input.description,
        referenceId: input.referenceId,
      },
      session,
    );

    return { transaction, balance: updatedAccount.balance };
  }

  async getTransactionHistory(
    accountId: string,
    { page, limit }: PaginationQuery,
  ): Promise<TransactionHistory> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) throw AppError.accountNotFound();

    const { items, totalRecords } = await this.transactionRepository.findPageByAccount(
      accountId,
      (page - 1) * limit,
      limit,
    );

    return {
      items,
      pagination: {
        currentPage: page,
        pageSize: limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
      },
    };
  }
}
