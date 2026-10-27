import { MongoMemoryReplSet } from 'mongodb-memory-server';

/** Jest only shares globals between globalSetup and globalTeardown. */
export const testGlobals = globalThis as { __MONGO_REPLSET__?: MongoMemoryReplSet };

/**
 * Starts a real single-node MongoDB replica set (transactions require one) unless
 * MONGODB_TEST_URI already points at an existing replica set, e.g. the Docker Compose one.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.MONGODB_TEST_URI) return;

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  testGlobals.__MONGO_REPLSET__ = replSet;
  process.env.MONGODB_TEST_URI = replSet.getUri('account_ledger_test');
}
