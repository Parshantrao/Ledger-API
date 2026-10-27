import { Schema, model, type Types } from 'mongoose';

export const TRANSACTION_TYPES = ['credit', 'debit'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const DESCRIPTION_MAX_LENGTH = 255;
/** Clients may send up to 100 characters; storage allows room for the "transfer:" prefix. */
export const REFERENCE_ID_MAX_LENGTH = 100;
const STORED_REFERENCE_ID_MAX_LENGTH = 128;

export interface Transaction {
  _id: Types.ObjectId;
  accountId: Types.ObjectId;
  type: TransactionType;
  /** Positive integer minor currency units (e.g. paise). */
  amount: number;
  description: string;
  referenceId: string;
  createdAt: Date;
}

// Ledger entries are append-only: every field is immutable and there is no updatedAt.
const transactionSchema = new Schema<Transaction>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, immutable: true },
    type: { type: String, enum: TRANSACTION_TYPES, required: true, immutable: true },
    amount: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      validate: { validator: Number.isInteger, message: 'Amount must be an integer.' },
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: DESCRIPTION_MAX_LENGTH,
      immutable: true,
    },
    referenceId: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: STORED_REFERENCE_ID_MAX_LENGTH,
      immutable: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// Idempotency: a reference ID can be used once per account (but may repeat across accounts).
transactionSchema.index({ accountId: 1, referenceId: 1 }, { unique: true });
// Supports the paginated, newest-first history query.
transactionSchema.index({ accountId: 1, createdAt: -1, _id: -1 });

export const TransactionModel = model<Transaction>('Transaction', transactionSchema);
