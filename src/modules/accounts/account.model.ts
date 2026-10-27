import { Schema, model, type Types } from 'mongoose';

export interface Account {
  _id: Types.ObjectId;
  name: string;
  /** Integer minor currency units (e.g. paise). Never negative. */
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

const accountSchema = new Schema<Account>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'Balance must be an integer.' },
    },
  },
  { timestamps: true, versionKey: false },
);

export const AccountModel = model<Account>('Account', accountSchema);
