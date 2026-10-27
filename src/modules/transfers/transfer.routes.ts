import { Router } from 'express';
import type { TransferController } from './transfer.controller';

export function createTransferRouter(controller: TransferController): Router {
  const router = Router();
  router.post('/', controller.create);
  return router;
}
