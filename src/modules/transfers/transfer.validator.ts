import { z } from 'zod';
import { objectIdSchema } from '../accounts/account.validator';
import {
  amountSchema,
  descriptionSchema,
  referenceIdSchema,
} from '../transactions/transaction.validator';

export const createTransferSchema = z
  .object({
    sourceAccountId: objectIdSchema('Source account ID'),
    destinationAccountId: objectIdSchema('Destination account ID'),
    amount: amountSchema,
    referenceId: referenceIdSchema,
    description: descriptionSchema,
  })
  .refine((data) => data.sourceAccountId !== data.destinationAccountId, {
    error: 'Source and destination accounts must be different.',
    path: ['destinationAccountId'],
  });

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
