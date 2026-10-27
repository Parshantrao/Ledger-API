import type { ClientSession } from 'mongoose';
import { AppError } from '../../errors/AppError';
import type {
  ITransactionRepository,
  NewTransaction,
  TransactionPage,
} from '../../interfaces/ITransactionRepository';
import { type Transaction, TransactionModel } from './transaction.model';

const DUPLICATE_KEY_ERROR_CODE = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === DUPLICATE_KEY_ERROR_CODE
  );
}

export class TransactionRepository implements ITransactionRepository {
  async create(input: NewTransaction, session: ClientSession): Promise<Transaction> {
    try {
      const transaction = await new TransactionModel(input).save({ session });
      return transaction.toObject();
    } catch (error) {
      // The unique { accountId, referenceId } index is the final guard against duplicates.
      // Rethrowing (not swallowing) lets the surrounding MongoDB transaction abort.
      if (isDuplicateKeyError(error)) throw AppError.duplicateReference();
      throw error;
    }
  }

  async existsByReference(
    accountId: string,
    referenceId: string,
    session: ClientSession,
  ): Promise<boolean> {
    const existing = await TransactionModel.exists({ accountId, referenceId }).session(session);
    return existing !== null;
  }

  async findPageByAccount(
    accountId: string,
    skip: number,
    limit: number,
  ): Promise<TransactionPage> {
    const filter = { accountId };
    // Two independent reads outside any transaction, so running them in parallel is safe.
    const [items, totalRecords] = await Promise.all([
      TransactionModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<Transaction[]>()
        .exec(),
      TransactionModel.countDocuments(filter).exec(),
    ]);
    return { items, totalRecords };
  }
}
