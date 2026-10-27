import mongoose, { type ConnectOptions, type mongo } from 'mongoose';

/**
 * Options for every financial MongoDB transaction: read from a majority-committed snapshot and
 * only acknowledge the commit once it is durable on a majority of the replica set.
 */
export const TRANSACTION_OPTIONS: mongo.TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
};

/**
 * Connects to MongoDB and makes sure every registered model's collection and indexes exist.
 *
 * Building indexes up front matters here: the unique { accountId, referenceId } index is part
 * of the duplicate-protection guarantee, so it must exist before the first request is served.
 */
export async function connectDatabase(
  uri: string,
  options: ConnectOptions = {},
): Promise<typeof mongoose> {
  await mongoose.connect(uri, options);
  await mongoose.connection.syncIndexes();
  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
