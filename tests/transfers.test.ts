import type { ClientSession } from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import type { NewTransaction } from '../src/interfaces/ITransactionRepository';
import { TransactionModel } from '../src/modules/transactions/transaction.model';
import { TransactionRepository } from '../src/modules/transactions/transaction.repository';
import { UNKNOWN_ACCOUNT_ID, createAccount, createFundedAccount, getBalance } from './helpers/api';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/testDb';

const app = createApp();

beforeAll(connectTestDb);
afterEach(async () => {
  jest.restoreAllMocks();
  await clearTestDb();
});
afterAll(disconnectTestDb);

function postTransfer(body: object): request.Test {
  return request(app).post('/api/transfers').send(body);
}

async function setupAccounts(sourceBalance = 10_000) {
  const source = await createFundedAccount(app, sourceBalance);
  const destination = await createAccount(app, 'Destination');
  return { source, destination };
}

const transferLedgerCount = () => TransactionModel.countDocuments({ referenceId: /^transfer:/ });

describe('POST /api/transfers', () => {
  it('moves money atomically and writes one debit and one credit', async () => {
    const { source, destination } = await setupAccounts(10_000);

    const res = await postTransfer({
      sourceAccountId: source,
      destinationAccountId: destination,
      amount: 3_000,
      referenceId: 'TRANSFER-001',
      description: 'Transfer to another account',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      referenceId: 'TRANSFER-001',
      amount: 3_000,
      sourceBalance: 7_000,
      destinationBalance: 3_000,
      debit: {
        accountId: source,
        type: 'debit',
        amount: 3_000,
        referenceId: 'transfer:TRANSFER-001',
      },
      credit: {
        accountId: destination,
        type: 'credit',
        amount: 3_000,
        referenceId: 'transfer:TRANSFER-001',
      },
    });
    expect(await getBalance(app, source)).toBe(7_000);
    expect(await getBalance(app, destination)).toBe(3_000);
    expect(await TransactionModel.countDocuments({ accountId: source, type: 'debit' })).toBe(1);
    expect(await TransactionModel.countDocuments({ accountId: destination })).toBe(1);
  });

  it.each([
    ['same source and destination', (s: string) => ({ destinationAccountId: s })],
    [
      'same account with different letter case',
      (s: string) => ({ destinationAccountId: s.toUpperCase() }),
    ],
    ['malformed source id', () => ({ sourceAccountId: 'nope' })],
    ['malformed destination id', () => ({ destinationAccountId: 'nope' })],
    ['zero amount', () => ({ amount: 0 })],
    ['negative amount', () => ({ amount: -50 })],
    ['fractional amount', () => ({ amount: 1.25 })],
    ['missing reference ID', () => ({ referenceId: undefined })],
    ['blank reference ID', () => ({ referenceId: '  ' })],
  ])('rejects %s with 400', async (_label, override) => {
    const { source, destination } = await setupAccounts();

    const res = await postTransfer({
      sourceAccountId: source,
      destinationAccountId: destination,
      amount: 100,
      referenceId: 'T-INVALID',
      ...override(source),
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await getBalance(app, source)).toBe(10_000);
    expect(await transferLedgerCount()).toBe(0);
  });

  it('rejects a nonexistent source account with 404', async () => {
    const destination = await createAccount(app);

    const res = await postTransfer({
      sourceAccountId: UNKNOWN_ACCOUNT_ID,
      destinationAccountId: destination,
      amount: 100,
      referenceId: 'T-404-SRC',
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      message: 'Source account not found.',
    });
    expect(await getBalance(app, destination)).toBe(0);
  });

  it('rejects a nonexistent destination account with 404 and keeps the source intact', async () => {
    const source = await createFundedAccount(app, 500);

    const res = await postTransfer({
      sourceAccountId: source,
      destinationAccountId: UNKNOWN_ACCOUNT_ID,
      amount: 100,
      referenceId: 'T-404-DST',
    });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Destination account not found.');
    expect(await getBalance(app, source)).toBe(500);
    expect(await transferLedgerCount()).toBe(0);
  });

  it('rejects insufficient funds with 409 and changes nothing', async () => {
    const { source, destination } = await setupAccounts(1_000);

    const res = await postTransfer({
      sourceAccountId: source,
      destinationAccountId: destination,
      amount: 1_001,
      referenceId: 'T-POOR',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await getBalance(app, source)).toBe(1_000);
    expect(await getBalance(app, destination)).toBe(0);
    expect(await transferLedgerCount()).toBe(0);
  });
});

describe('Transfer rollback', () => {
  it('rolls back the completed debit leg when the credit leg fails', async () => {
    const { source, destination } = await setupAccounts(5_000);
    const realCreate = TransactionRepository.prototype.create;
    // Let the debit ledger write succeed, then fail the credit ledger write: by then the
    // source debit, its ledger entry and the destination credit have all been applied.
    jest.spyOn(TransactionRepository.prototype, 'create').mockImplementation(async function (
      this: TransactionRepository,
      input: NewTransaction,
      session: ClientSession,
    ) {
      if (input.type === 'credit') throw new Error('Simulated failure on credit leg');
      return realCreate.call(this, input, session);
    });

    const res = await postTransfer({
      sourceAccountId: source,
      destinationAccountId: destination,
      amount: 2_000,
      referenceId: 'T-ROLLBACK',
    });

    expect(res.status).toBe(500);
    expect(await getBalance(app, source)).toBe(5_000);
    expect(await getBalance(app, destination)).toBe(0);
    expect(await transferLedgerCount()).toBe(0);
  });

  it('rolls back the source debit when the destination leg hits a reference conflict', async () => {
    const { source, destination } = await setupAccounts(5_000);
    const otherSource = await createFundedAccount(app, 5_000);
    const body = { destinationAccountId: destination, amount: 1_000, referenceId: 'T-CLASH' };
    await postTransfer({ ...body, sourceAccountId: otherSource }).expect(201);

    // Same reference ID into the same destination from a different source: the debit leg
    // succeeds, the credit leg collides, and the whole transfer must be undone.
    const res = await postTransfer({ ...body, sourceAccountId: source });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_REFERENCE');
    expect(await getBalance(app, source)).toBe(5_000);
    expect(await getBalance(app, destination)).toBe(1_000);
    expect(await TransactionModel.countDocuments({ accountId: source })).toBe(1);
  });
});

describe('Transfer idempotency', () => {
  it('does not execute a repeated transfer request twice', async () => {
    const { source, destination } = await setupAccounts(10_000);
    const body = {
      sourceAccountId: source,
      destinationAccountId: destination,
      amount: 3_000,
      referenceId: 'TRANSFER-REPEAT',
    };
    await postTransfer(body).expect(201);

    const res = await postTransfer(body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_REFERENCE');
    expect(await getBalance(app, source)).toBe(7_000);
    expect(await getBalance(app, destination)).toBe(3_000);
    expect(await transferLedgerCount()).toBe(2);
  });

  it('executes concurrent identical transfer requests exactly once', async () => {
    const { source, destination } = await setupAccounts(10_000);
    const body = {
      sourceAccountId: source,
      destinationAccountId: destination,
      amount: 1_000,
      referenceId: 'TRANSFER-RACE',
    };

    const responses = await Promise.all(Array.from({ length: 5 }, () => postTransfer(body)));

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await getBalance(app, source)).toBe(9_000);
    expect(await getBalance(app, destination)).toBe(1_000);
    expect(await transferLedgerCount()).toBe(2);
  });
});
