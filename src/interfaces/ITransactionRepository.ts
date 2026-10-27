import type { ClientSession } from 'mongoose';
import type { Transaction, TransactionType } from '../modules/transactions/transaction.model';

export interface NewTransaction {
  accountId: string;
  type: TransactionType;
  amount: number;
  description: string;
  referenceId: string;
}

export interface TransactionPage {
  items: Transaction[];
  totalRecords: number;
}

/**
 * Persistence contract for the ledger. It is append-only by design: there are no
 * update or delete methods, so transactions are immutable once written.
 */
export interface ITransactionRepository {
  /** Inserts a ledger entry. Throws AppError DUPLICATE_REFERENCE on a reused reference ID. */
  create(input: NewTransaction, session: ClientSession): Promise<Transaction>;

  existsByReference(
    accountId: string,
    referenceId: string,
    session: ClientSession,
  ): Promise<boolean>;

  /** Newest first (createdAt desc, then _id desc as a deterministic tie-breaker). */
  findPageByAccount(accountId: string, skip: number, limit: number): Promise<TransactionPage>;
}
