import type { Express } from 'express';
import request from 'supertest';

export const UNKNOWN_ACCOUNT_ID = '507f1f77bcf86cd799439011';

export async function createAccount(app: Express, name = 'Test Account'): Promise<string> {
  const res = await request(app).post('/api/accounts').send({ name }).expect(201);
  return res.body.data._id as string;
}

export function postTransaction(app: Express, accountId: string, body: object): request.Test {
  return request(app).post(`/api/accounts/${accountId}/transactions`).send(body);
}

export async function getBalance(app: Express, accountId: string): Promise<number> {
  const res = await request(app).get(`/api/accounts/${accountId}`).expect(200);
  return res.body.data.balance as number;
}

/** Creates an account and credits it with `amount` so debits can be tested. */
export async function createFundedAccount(app: Express, amount: number): Promise<string> {
  const id = await createAccount(app);
  await postTransaction(app, id, {
    type: 'credit',
    amount,
    referenceId: 'INITIAL-FUNDING',
  }).expect(201);
  return id;
}
