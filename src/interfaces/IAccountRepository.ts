import type { ClientSession } from 'mongoose';
import type { Account } from '../modules/accounts/account.model';

/**
 * Persistence contract for accounts. Balances can only change through the two
 * session-bound methods below, which services call inside a MongoDB transaction.
 */
export interface IAccountRepository {
  create(name: string): Promise<Account>;

  findById(id: string, session?: ClientSession): Promise<Account | null>;

  /** Adds `amount` to the balance. Returns the updated account, or null if it does not exist. */
  incrementBalance(id: string, amount: number, session: ClientSession): Promise<Account | null>;

  /**
   * Atomically subtracts `amount` only if the balance is at least `amount`.
   * Returns the updated account, or null if the account is missing or has insufficient funds.
   */
  decrementBalanceIfSufficient(
    id: string,
    amount: number,
    session: ClientSession,
  ): Promise<Account | null>;
}
