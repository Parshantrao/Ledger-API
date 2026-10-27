import { testGlobals } from './globalSetup';

export default async function globalTeardown(): Promise<void> {
  await testGlobals.__MONGO_REPLSET__?.stop();
}
