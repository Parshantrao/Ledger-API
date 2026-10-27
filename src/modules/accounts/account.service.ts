import { AppError } from '../../errors/AppError';
import type { IAccountRepository } from '../../interfaces/IAccountRepository';
import type { Account } from './account.model';
import type { CreateAccountInput } from './account.validator';

export class AccountService {
  constructor(private readonly accountRepository: IAccountRepository) {}

  /** New accounts always start with a zero balance; clients cannot set it. */
  createAccount(input: CreateAccountInput): Promise<Account> {
    return this.accountRepository.create(input.name);
  }

  async getAccount(id: string): Promise<Account> {
    const account = await this.accountRepository.findById(id);
    if (!account) throw AppError.accountNotFound();
    return account;
  }
}
