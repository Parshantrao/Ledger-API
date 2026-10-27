import { Types } from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { TransactionModel } from '../src/modules/transactions/transaction.model';
import {
  UNKNOWN_ACCOUNT_ID,
  createAccount,
  createFundedAccount,
  getBalance,
  postTransaction,
} from './helpers/api';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/testDb';

const app = createApp();

beforeAll(connectTestDb);
afterEach(clearTestDb);
afterAll(disconnectTestDb);

describe('POST /api/accounts/:id/transactions', () => {
  it('creates a credit and increases the balance', async () => {
    const accountId = await createAccount(app);

    const res = await postTransaction(app, accountId, {
      type: 'credit',
      amount: 10_000,
      referenceId: 'REF-1',
      description: 'Salary',
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: {
        balance: 10_000,
        transaction: {
          _id: expect.stringMatching(/^[a-f\d]{24}$/),
          accountId,
          type: 'credit',
          amount: 10_000,
          description: 'Salary',
          referenceId: 'REF-1',
          createdAt: expect.any(String),
        },
      },
    });
    expect(await getBalance(app, accountId)).toBe(10_000);
  });

  it('creates a debit when funds are sufficient', async () => {
    const accountId = await createFundedAccount(app, 5_000);

    const res = await postTransaction(app, accountId, {
      type: 'debit',
      amount: 1_500,
      referenceId: 'REF-2',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.transaction).toMatchObject({ type: 'debit', amount: 1_500 });
    expect(res.body.data.balance).toBe(3_500);
  });

  it('keeps the balance equal to credits minus debits', async () => {
    const accountId = await createAccount(app);
    const steps = [
      { type: 'credit', amount: 100 },
      { type: 'credit', amount: 50 },
      { type: 'debit', amount: 30 },
      { type: 'debit', amount: 20 },
    ];
    for (const [i, step] of steps.entries()) {
      await postTransaction(app, accountId, { ...step, referenceId: `STEP-${i}` }).expect(201);
    }

    expect(await getBalance(app, accountId)).toBe(100);
  });

  it.each([
    ['invalid type', { type: 'refund', amount: 100, referenceId: 'R' }],
    ['zero amount', { type: 'credit', amount: 0, referenceId: 'R' }],
    ['negative amount', { type: 'credit', amount: -100, referenceId: 'R' }],
    ['fractional amount', { type: 'credit', amount: 10.5, referenceId: 'R' }],
    ['string amount', { type: 'credit', amount: '100', referenceId: 'R' }],
    ['missing reference ID', { type: 'credit', amount: 100 }],
    ['blank reference ID', { type: 'credit', amount: 100, referenceId: '   ' }],
    ['reserved reference ID', { type: 'credit', amount: 100, referenceId: 'transfer:X' }],
    ['non-string description', { type: 'credit', amount: 100, referenceId: 'R', description: 5 }],
    [
      'over-long description',
      { type: 'credit', amount: 100, referenceId: 'R', description: 'x'.repeat(256) },
    ],
  ])('rejects %s with 400 and leaves the balance unchanged', async (_label, body) => {
    const accountId = await createAccount(app);

    const res = await postTransaction(app, accountId, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await getBalance(app, accountId)).toBe(0);
  });

  it('rejects a malformed account id with 400', async () => {
    const res = await postTransaction(app, 'bad-id', {
      type: 'credit',
      amount: 100,
      referenceId: 'R',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a nonexistent account with 404 and writes nothing', async () => {
    const res = await postTransaction(app, UNKNOWN_ACCOUNT_ID, {
      type: 'credit',
      amount: 100,
      referenceId: 'R',
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(await TransactionModel.countDocuments()).toBe(0);
  });

  it('rejects a debit larger than the balance with 409', async () => {
    const accountId = await createFundedAccount(app, 1_000);

    const res = await postTransaction(app, accountId, {
      type: 'debit',
      amount: 1_001,
      referenceId: 'TOO-MUCH',
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'INSUFFICIENT_BALANCE', message: 'The account has insufficient funds.' },
    });
    expect(await getBalance(app, accountId)).toBe(1_000);
    expect(await TransactionModel.countDocuments({ accountId })).toBe(1);
  });

  it('rejects a duplicate reference ID with 409 without changing the balance', async () => {
    const accountId = await createAccount(app);
    const body = { type: 'credit', amount: 700, referenceId: 'DUP-1' };
    await postTransaction(app, accountId, body).expect(201);

    const res = await postTransaction(app, accountId, body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_REFERENCE');
    expect(await getBalance(app, accountId)).toBe(700);
    expect(await TransactionModel.countDocuments({ accountId })).toBe(1);
  });

  it('answers a repeated debit with DUPLICATE_REFERENCE even when funds are now short', async () => {
    const accountId = await createFundedAccount(app, 500);
    const body = { type: 'debit', amount: 500, referenceId: 'PAY-1' };
    await postTransaction(app, accountId, body).expect(201);

    const res = await postTransaction(app, accountId, body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_REFERENCE');
    expect(await getBalance(app, accountId)).toBe(0);
  });

  it('allows the same reference ID on different accounts', async () => {
    const first = await createAccount(app, 'First');
    const second = await createAccount(app, 'Second');
    const body = { type: 'credit', amount: 100, referenceId: 'SHARED-REF' };

    await postTransaction(app, first, body).expect(201);
    await postTransaction(app, second, body).expect(201);

    expect(await getBalance(app, first)).toBe(100);
    expect(await getBalance(app, second)).toBe(100);
  });
});

describe('GET /api/accounts/:id/transactions', () => {
  async function seedCredits(accountId: string, count: number): Promise<void> {
    for (let i = 1; i <= count; i++) {
      await postTransaction(app, accountId, {
        type: 'credit',
        amount: i,
        referenceId: `SEED-${i}`,
      }).expect(201);
    }
  }

  it('returns transactions newest first', async () => {
    const accountId = await createAccount(app);
    await seedCredits(accountId, 3);

    const res = await request(app).get(`/api/accounts/${accountId}/transactions`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { referenceId: string }) => t.referenceId)).toEqual([
      'SEED-3',
      'SEED-2',
      'SEED-1',
    ]);
  });

  it('breaks createdAt ties by _id descending', async () => {
    const accountId = await createAccount(app);
    const sameTime = new Date('2024-01-01T00:00:00.000Z');
    const ids = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
    // Raw driver insert so the fixture keeps identical timestamps.
    await TransactionModel.collection.insertMany(
      ids.map((_id, i) => ({
        _id,
        accountId: new Types.ObjectId(accountId),
        type: 'credit',
        amount: 1,
        description: '',
        referenceId: `TIE-${i}`,
        createdAt: sameTime,
      })),
    );

    const res = await request(app).get(`/api/accounts/${accountId}/transactions`).expect(200);

    expect(res.body.data.map((t: { _id: string }) => t._id)).toEqual(ids.map(String).reverse());
  });

  it('applies defaults and returns pagination metadata', async () => {
    const accountId = await createAccount(app);
    await seedCredits(accountId, 12);

    const res = await request(app).get(`/api/accounts/${accountId}/transactions`).expect(200);

    expect(res.body.data).toHaveLength(10);
    expect(res.body.pagination).toEqual({
      currentPage: 1,
      pageSize: 10,
      totalRecords: 12,
      totalPages: 2,
    });
  });

  it('returns the requested page', async () => {
    const accountId = await createAccount(app);
    await seedCredits(accountId, 7);

    const res = await request(app)
      .get(`/api/accounts/${accountId}/transactions?page=2&limit=3`)
      .expect(200);

    expect(res.body.data.map((t: { referenceId: string }) => t.referenceId)).toEqual([
      'SEED-4',
      'SEED-3',
      'SEED-2',
    ]);
    expect(res.body.pagination).toEqual({
      currentPage: 2,
      pageSize: 3,
      totalRecords: 7,
      totalPages: 3,
    });
  });

  it('returns an empty page beyond the last page', async () => {
    const accountId = await createAccount(app);
    await seedCredits(accountId, 2);

    const res = await request(app)
      .get(`/api/accounts/${accountId}/transactions?page=5&limit=10`)
      .expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.totalRecords).toBe(2);
  });

  it('only returns transactions for the requested account', async () => {
    const mine = await createAccount(app, 'Mine');
    const other = await createAccount(app, 'Other');
    await postTransaction(app, mine, { type: 'credit', amount: 1, referenceId: 'A' }).expect(201);
    await postTransaction(app, other, { type: 'credit', amount: 1, referenceId: 'B' }).expect(201);

    const res = await request(app).get(`/api/accounts/${mine}/transactions`).expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].accountId).toBe(mine);
    expect(res.body.pagination.totalRecords).toBe(1);
  });

  it.each(['page=0', 'page=-1', 'page=abc', 'page=1.5', 'limit=0', 'limit=101', 'limit=1e1'])(
    'rejects invalid pagination "%s" with 400',
    async (query) => {
      const accountId = await createAccount(app);

      const res = await request(app).get(`/api/accounts/${accountId}/transactions?${query}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('accepts the maximum page size', async () => {
    const accountId = await createAccount(app);
    await request(app).get(`/api/accounts/${accountId}/transactions?limit=100`).expect(200);
  });

  it('returns 404 for a nonexistent account', async () => {
    const res = await request(app).get(`/api/accounts/${UNKNOWN_ACCOUNT_ID}/transactions`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});

describe('Ledger immutability', () => {
  it.each(['put', 'patch', 'delete'] as const)(
    'exposes no %s endpoint for transactions',
    async (method) => {
      const accountId = await createAccount(app);
      const created = await postTransaction(app, accountId, {
        type: 'credit',
        amount: 100,
        referenceId: 'IMMUTABLE',
      }).expect(201);
      const txId = created.body.data.transaction._id as string;
      const base = `/api/accounts/${accountId}/transactions`;

      for (const path of [base, `${base}/${txId}`]) {
        const res = await request(app)[method](path).send({ amount: 999_999 });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
      }

      const stored = await TransactionModel.findById(txId).lean();
      expect(stored?.amount).toBe(100);
      expect(await getBalance(app, accountId)).toBe(100);
    },
  );

  it('exposes no endpoint to modify an account balance directly', async () => {
    const accountId = await createAccount(app);

    for (const method of ['put', 'patch'] as const) {
      const res = await request(app)[method](`/api/accounts/${accountId}`).send({ balance: 5000 });
      expect(res.status).toBe(404);
    }
    expect(await getBalance(app, accountId)).toBe(0);
  });
});
