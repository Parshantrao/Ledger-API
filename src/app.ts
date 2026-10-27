import express, { type Express } from 'express';
import mongoose, { type Connection } from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './docs/openapi';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { AccountController } from './modules/accounts/account.controller';
import { AccountRepository } from './modules/accounts/account.repository';
import { createAccountRouter } from './modules/accounts/account.routes';
import { AccountService } from './modules/accounts/account.service';
import { TransactionController } from './modules/transactions/transaction.controller';
import { TransactionRepository } from './modules/transactions/transaction.repository';
import { createTransactionRouter } from './modules/transactions/transaction.routes';
import { TransactionService } from './modules/transactions/transaction.service';
import { TransferController } from './modules/transfers/transfer.controller';
import { createTransferRouter } from './modules/transfers/transfer.routes';
import { TransferService } from './modules/transfers/transfer.service';

/**
 * Builds the Express application and wires dependencies by hand (constructor injection).
 * The MongoDB connection is passed in so tests and the server share the same composition.
 */
export function createApp(connection: Connection = mongoose.connection): Express {
  // Persistence
  const accountRepository = new AccountRepository();
  const transactionRepository = new TransactionRepository();

  // Business logic
  const accountService = new AccountService(accountRepository);
  const transactionService = new TransactionService(
    connection,
    accountRepository,
    transactionRepository,
  );
  const transferService = new TransferService(connection, accountRepository, transactionService);

  // HTTP
  const accountController = new AccountController(accountService);
  const transactionController = new TransactionController(transactionService);
  const transferController = new TransferController(transferService);

  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/api-docs.json', (_req, res) => {
    res.json(openApiSpec);
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  app.use('/api/accounts', createAccountRouter(accountController));
  app.use('/api/accounts/:id/transactions', createTransactionRouter(transactionController));
  app.use('/api/transfers', createTransferRouter(transferController));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
