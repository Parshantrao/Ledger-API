import type { Request, Response } from 'express';
import type { AccountService } from './account.service';
import { accountIdParamsSchema, createAccountSchema } from './account.validator';

/**
 * HTTP adapter for accounts: validates input, delegates to the service, shapes the response.
 * Handlers are arrow properties so `this` stays bound when passed to the router.
 */
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const input = createAccountSchema.parse(req.body ?? {});
    const account = await this.accountService.createAccount(input);
    res.status(201).json({ success: true, data: account });
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = accountIdParamsSchema.parse(req.params);
    const account = await this.accountService.getAccount(id);
    res.status(200).json({ success: true, data: account });
  };
}
