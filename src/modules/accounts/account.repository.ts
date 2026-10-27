import type { ClientSession } from 'mongoose';
import type { IAccountRepository } from '../../interfaces/IAccountRepository';
import { type Account, AccountModel } from './account.model';

export class AccountRepository implements IAccountRepository {
  async create(name: string): Promise<Account> {
    const account = await AccountModel.create({ name, balance: 0 });
    return account.toObject();
  }

  findById(id: string, session?: ClientSession): Promise<Account | null> {
    return AccountModel.findById(id)
      .session(session ?? null)
      .lean<Account>()
      .exec();
  }

  incrementBalance(id: string, amount: number, session: ClientSession): Promise<Account | null> {
    return AccountModel.findByIdAndUpdate(
      id,
      { $inc: { balance: amount } },
      { returnDocument: 'after', session },
    )
      .lean<Account>()
      .exec();
  }

  decrementBalanceIfSufficient(
    id: string,
    amount: number,
    session: ClientSession,
  ): Promise<Account | null> {
    // The balance condition lives in the filter, so the check and the write are a single
    // atomic operation: two concurrent debits can never both pass the check.
    return AccountModel.findOneAndUpdate(
      { _id: id, balance: { $gte: amount } },
      { $inc: { balance: -amount } },
      { returnDocument: 'after', session },
    )
      .lean<Account>()
      .exec();
  }
}
