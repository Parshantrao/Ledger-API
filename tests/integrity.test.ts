import { createApp } from '../src/app';
import { AccountModel } from '../src/modules/accounts/account.model';
import { TransactionModel } from '../src/modules/transactions/transaction.model';
import { TransactionRepository } from '../src/modules/transactions/transaction.repository';
import { createAccount, createFundedAccount, getBalance, postTransaction } from './helpers/api';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/testDb';

const app = createApp();

beforeAll(connectTestDb);
afterEach(async () => {
  jest.restoreAllMocks();
  await clearTestDb();
});
afterAll(disconnectTestDb);

/** Ledger-derived balance: sum of credits minus sum of debits for the account. */
async function ledgerBalance(accountId: string): Promise<number> {
  const entries = await TransactionModel.find({ accountId }).lean();
  return entries.reduce((sum, t) => sum + (t.type === 'credit' ? t.amount : -t.amount), 0);
}

describe('Atomicity: balance and ledger roll back together', () => {
  // These tests use a real replica-set MongoDB. Only the ledger insert is made to fail;
  // the rollback itself is MongoDB's actual transaction behaviour, not a mock.
  it.each([
    ['credit', 0, 500],
    ['debit', 1_000, 400],
  ])(
    'rolls back the balance update of a %s when the ledger write fails',
    async (type, initialBalance, amount) => {
      const accountId =
        initialBalance > 0
          ? await createFundedAccount(app, initialBalance)
          : await createAccount(app);
      const ledgerBefore = await TransactionModel.countDocuments({ accountId });
      jest
        .spyOn(TransactionRepository.prototype, 'create')
        .mockRejectedValueOnce(new Error('Simulated ledger write failure'));

      const res = await postTransaction(app, accountId, { type, amount, referenceId: 'FAIL-1' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
      });
      expect(await getBalance(app, accountId)).toBe(initialBalance);
      expect(await TransactionModel.countDocuments({ accountId })).toBe(ledgerBefore);
    },
  );

  it('can apply the same reference ID after a failed (rolled back) attempt', async () => {
    const accountId = await createAccount(app);
    jest
      .spyOn(TransactionRepository.prototype, 'create')
      .mockRejectedValueOnce(new Error('Simulated ledger write failure'));
    const body = { type: 'credit', amount: 250, referenceId: 'RETRY-ME' };

    await postTransaction(app, accountId, body).expect(500);
    await postTransaction(app, accountId, body).expect(201);

    expect(await getBalance(app, accountId)).toBe(250);
    expect(await TransactionModel.countDocuments({ accountId })).toBe(1);
  });
});

describe('Unique index as the final duplicate guard', () => {
  it('maps a database duplicate-key error to 409 and rolls back the balance', async () => {
    const accountId = await createAccount(app);
    const body = { type: 'credit', amount: 100, referenceId: 'IDX-1' };
    await postTransaction(app, accountId, body).expect(201);
    // Skip the application-level pre-check so only the unique index can catch the duplicate.
    jest.spyOn(TransactionRepository.prototype, 'existsByReference').mockResolvedValue(false);

    const res = await postTransaction(app, accountId, body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_REFERENCE');
    expect(await getBalance(app, accountId)).toBe(100);
    expect(await TransactionModel.countDocuments({ accountId })).toBe(1);
  });
});

describe('Failed requests leave no partial state', () => {
  it('leaves balance and ledger untouched for rejected requests', async () => {
    const accountId = await createFundedAccount(app, 300);

    await postTransaction(app, accountId, { type: 'debit', amount: 301, referenceId: 'X1' }).expect(
      409,
    );
    await postTransaction(app, accountId, {
      type: 'credit',
      amount: 1,
      referenceId: 'INITIAL-FUNDING',
    }).expect(409);
    await postTransaction(app, accountId, { type: 'debit', amount: -5, referenceId: 'X2' }).expect(
      400,
    );

    expect(await getBalance(app, accountId)).toBe(300);
    expect(await TransactionModel.countDocuments({ accountId })).toBe(1);
    expect(await ledgerBalance(accountId)).toBe(300);
  });
});

describe('Concurrency', () => {
  it('never overdraws an account under concurrent debits', async () => {
    const accountId = await createFundedAccount(app, 100);

    // 10 simultaneous debits of 30 against a balance of 100: exactly 3 can succeed.
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        postTransaction(app, accountId, { type: 'debit', amount: 30, referenceId: `C-${i}` }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    for (const r of responses.filter((r) => r.status === 409)) {
      expect(r.body.error.code).toBe('INSUFFICIENT_BALANCE');
    }

    const account = await AccountModel.findById(accountId).lean();
    expect(account?.balance).toBe(10);
    expect(await ledgerBalance(accountId)).toBe(10);
  });

  it('applies a reference ID only once under concurrent duplicate requests', async () => {
    const accountId = await createAccount(app);
    const body = { type: 'credit', amount: 100, referenceId: 'SAME-REF' };

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postTransaction(app, accountId, body)),
    );

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    for (const r of responses.filter((r) => r.status === 409)) {
      expect(r.body.error.code).toBe('DUPLICATE_REFERENCE');
    }
    expect(await getBalance(app, accountId)).toBe(100);
    expect(await TransactionModel.countDocuments({ accountId })).toBe(1);
  });
});
