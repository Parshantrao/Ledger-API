import request from 'supertest';
import { createApp } from '../src/app';
import { clearTestDb, connectTestDb, disconnectTestDb } from './helpers/testDb';

const app = createApp();

beforeAll(connectTestDb);
afterEach(clearTestDb);
afterAll(disconnectTestDb);

describe('POST /api/accounts', () => {
  it('creates an account with a zero balance', async () => {
    const res = await request(app).post('/api/accounts').send({ name: '  Alice  ' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: {
        _id: expect.stringMatching(/^[a-f\d]{24}$/),
        name: 'Alice',
        balance: 0,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
  });

  it('ignores a client-supplied balance', async () => {
    const res = await request(app).post('/api/accounts').send({ name: 'Bob', balance: 1_000_000 });

    expect(res.status).toBe(201);
    expect(res.body.data.balance).toBe(0);
  });

  it.each([
    ['missing', {}],
    ['blank', { name: '   ' }],
    ['non-string', { name: 42 }],
  ])('rejects a %s name with 400', async (_label, body) => {
    const res = await request(app).post('/api/accounts').send(body);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/accounts/:id', () => {
  it('retrieves an existing account', async () => {
    const created = await request(app).post('/api/accounts').send({ name: 'Carol' });

    const res = await request(app).get(`/api/accounts/${created.body.data._id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: created.body.data });
  });

  it('rejects a malformed ObjectId with 400', async () => {
    const res = await request(app).get('/api/accounts/not-an-id');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Account ID must be a valid MongoDB ObjectId.',
    });
  });

  it('rejects 12-character strings that Mongoose would otherwise accept', async () => {
    const res = await request(app).get('/api/accounts/abcdefghijkl');
    expect(res.status).toBe(400);
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    const res = await request(app).get('/api/accounts/507f1f77bcf86cd799439011');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found.' },
    });
  });
});
