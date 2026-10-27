import type { ClientSession, Connection } from 'mongoose';
import { TRANSACTION_OPTIONS } from '../../config/database';
import { AppError } from '../../errors/AppError';
import type { IAccountRepository } from '../../interfaces/IAccountRepository';
import type { Transaction } from '../transactions/transaction.model';
import type { TransactionService } from '../transactions/transaction.service';
import { TRANSFER_REFERENCE_PREFIX } from '../transactions/transaction.validator';
import type { CreateTransferInput } from './transfer.validator';

export interface TransferResult {
  referenceId: string;
  amount: number;
  debit: Transaction;
  credit: Transaction;
  sourceBalance: number;
  destinationBalance: number;
}

export class TransferService {
  constructor(
    private readonly connection: Connection,
    private readonly accountRepository: IAccountRepository,
    private readonly transactionService: TransactionService,
  ) {}

  /**
   * Moves money between two accounts in ONE MongoDB transaction: debit source, credit
   * destination, and write both ledger entries. If any step fails the whole transaction
   * aborts, so a partial transfer (money leaving without arriving) cannot happen.
   *
   * Idempotency: both legs are stored with referenceId "transfer:<referenceId>". The unique
   * { accountId, referenceId } index means a repeated request collides on the source leg
   * and is rejected with DUPLICATE_REFERENCE before any money moves.
   */
  async transfer(input: CreateTransferInput): Promise<TransferResult> {
    const { sourceAccountId, destinationAccountId, amount, description } = input;
    if (sourceAccountId === destinationAccountId) {
      throw new AppError(
        400,
        'SAME_ACCOUNT_TRANSFER',
        'Source and destination accounts must be different.',
      );
    }
    const ledgerReferenceId = `${TRANSFER_REFERENCE_PREFIX}${input.referenceId}`;

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        // Check both accounts up front so a missing account is reported as 404
        // rather than, say, an insufficient-balance error on the source.
        await this.ensureAccountExists(sourceAccountId, 'Source account not found.', session);
        await this.ensureAccountExists(
          destinationAccountId,
          'Destination account not found.',
          session,
        );

        const debit = await this.transactionService.applyTransaction(
          sourceAccountId,
          { type: 'debit', amount, description, referenceId: ledgerReferenceId },
          session,
        );
        const credit = await this.transactionService.applyTransaction(
          destinationAccountId,
          { type: 'credit', amount, description, referenceId: ledgerReferenceId },
          session,
        );

        return {
          referenceId: input.referenceId,
          amount,
          debit: debit.transaction,
          credit: credit.transaction,
          sourceBalance: debit.balance,
          destinationBalance: credit.balance,
        };
      }, TRANSACTION_OPTIONS);
    } finally {
      await session.endSession();
    }
  }

  private async ensureAccountExists(
    accountId: string,
    notFoundMessage: string,
    session: ClientSession,
  ): Promise<void> {
    const account = await this.accountRepository.findById(accountId, session);
    if (!account) throw AppError.accountNotFound(notFoundMessage);
  }
}
