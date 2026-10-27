import mongoose from 'mongoose';
import { z } from 'zod';

export const ACCOUNT_NAME_MAX_LENGTH = 100;

export const objectIdSchema = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .refine(
      (value) => mongoose.isObjectIdOrHexString(value),
      { message: `${label} must be a valid MongoDB ObjectId.` }
    )
    .transform((value) => value.toLowerCase());

export const accountIdParamsSchema = z.object({
  id: objectIdSchema('Account ID'),
});

export const createAccountSchema = z.object({
  name: z
    .string({ error: 'Name is required and must be a string.' })
    .trim()
    .min(1, 'Name must not be blank.')
    .max(
      ACCOUNT_NAME_MAX_LENGTH,
      `Name must be at most ${ACCOUNT_NAME_MAX_LENGTH} characters.`
    ),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;