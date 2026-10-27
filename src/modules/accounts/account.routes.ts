import { Router } from 'express';
import type { AccountController } from './account.controller';

// Deliberately no PUT/PATCH/DELETE: balances change only through transactions.
export function createAccountRouter(controller: AccountController): Router {
  const router = Router();
  router.post('/', controller.create);
  router.get('/:id', controller.getById);
  return router;
}
