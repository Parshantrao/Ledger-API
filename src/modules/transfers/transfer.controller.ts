import type { Request, Response } from 'express';
import type { TransferService } from './transfer.service';
import { createTransferSchema } from './transfer.validator';

export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const input = createTransferSchema.parse(req.body ?? {});
    const result = await this.transferService.transfer(input);
    res.status(201).json({ success: true, data: result });
  };
}
