import mongoose from 'mongoose';
import os from 'node:os';
import { connectDatabase, disconnectDatabase } from '../../src/config/database';

export async function connectTestDb(): Promise<void> {
  const uri = process.env.MONGODB_TEST_URI;
  if (!uri) throw new Error('MONGODB_TEST_URI is not set (globalSetup should provide it).');
  // The MongoDB driver loads `os` via dynamic import(), which Jest's VM sandbox does not
  // support; without this the handshake metadata is empty and the server rejects it.
  await connectDatabase(uri, { runtimeAdapters: { os } });

  // Guard against wiping a real database: clearTestDb deletes every document.
  if (!mongoose.connection.name.includes('test')) {
    await disconnectDatabase();
    throw new Error(`Refusing to run tests against database "${mongoose.connection.name}".`);
  }
}

/** Removes all documents but keeps collections and indexes (the unique index is under test). */
export async function clearTestDb(): Promise<void> {
  for (const model of Object.values(mongoose.connection.models)) {
    await model.deleteMany({});
  }
}

export async function disconnectTestDb(): Promise<void> {
  await disconnectDatabase();
}
