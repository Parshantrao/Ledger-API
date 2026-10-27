import request from 'supertest';
import { createApp } from '../src/app';
import { connectTestDb, disconnectTestDb } from './helpers/testDb';

const app = createApp();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

describe('App foundation', () => {
  it('returns a consistent 404 for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'ROUTE_NOT_FOUND', message: expect.any(String) },
    });
  });

  it('serves the OpenAPI document and Swagger UI', async () => {
    const spec = await request(app).get('/api-docs.json');
    expect(spec.status).toBe(200);
    expect(spec.body.openapi).toBe('3.0.3');
    expect(Object.keys(spec.body.paths)).toEqual(
      expect.arrayContaining(['/api/accounts', '/api/accounts/{id}/transactions']),
    );

    const ui = await request(app).get('/api-docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
  });

  it('rejects malformed JSON bodies with 400', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST_BODY');
  });
});
