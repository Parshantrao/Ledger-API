import { Router } from 'express';
import type { TransactionController } from './transaction.controller';

/**
 * Mounted at /api/accounts/:id/transactions (mergeParams exposes :id).
 * The ledger is append-only, so there are intentionally no update or delete routes.
 */
export function createTransactionRouter(controller: TransactionController): Router {
  const router = Router({ mergeParams: true });
  router.post('/', controller.create);
  router.get('/', controller.list);
  return router;
}
