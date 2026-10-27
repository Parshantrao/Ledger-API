import type { Request, Response } from 'express';
import { accountIdParamsSchema } from '../accounts/account.validator';
import type { TransactionService } from './transaction.service';
import { createTransactionSchema, paginationQuerySchema } from './transaction.validator';

export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const { id } = accountIdParamsSchema.parse(req.params);
    const input = createTransactionSchema.parse(req.body ?? {});
    const result = await this.transactionService.createTransaction(id, input);
    res.status(201).json({ success: true, data: result });
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const { id } = accountIdParamsSchema.parse(req.params);
    const query = paginationQuerySchema.parse(req.query);
    const { items, pagination } = await this.transactionService.getTransactionHistory(id, query);
    res.status(200).json({ success: true, data: items, pagination });
  };
}
