import { ACCOUNT_NAME_MAX_LENGTH } from '../modules/accounts/account.validator';
import {
  DESCRIPTION_MAX_LENGTH,
  REFERENCE_ID_MAX_LENGTH,
} from '../modules/transactions/transaction.model';
import { MAX_PAGE_SIZE } from '../modules/transactions/transaction.validator';

const objectId = {
  type: 'string',
  pattern: '^[a-fA-F0-9]{24}$',
  example: '665f1c2e8b3a4d0012345678',
};

const errorResponse = (description: string, code: string, message: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
      example: { success: false, error: { code, message } },
    },
  },
});

const responses = {
  ValidationError: errorResponse(
    'Invalid request data or malformed ID',
    'VALIDATION_ERROR',
    'Account ID must be a valid MongoDB ObjectId.',
  ),
  AccountNotFound: errorResponse('Account not found', 'ACCOUNT_NOT_FOUND', 'Account not found.'),
  InternalError: errorResponse(
    'Unexpected error',
    'INTERNAL_ERROR',
    'An unexpected error occurred.',
  ),
};

const accountIdParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Account ID',
  schema: objectId,
};

const referenceIdProperty = {
  type: 'string',
  minLength: 1,
  maxLength: REFERENCE_ID_MAX_LENGTH,
  description:
    'Client-generated idempotency key, unique per account. Reusing it for the same account ' +
    'returns 409 DUPLICATE_REFERENCE and has no effect.',
};

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Account Ledger API',
    version: '1.0.0',
    description:
      'Accounts, credit/debit transactions, and transfers. All amounts are positive integers in ' +
      'minor currency units (e.g. paise: 10000 = ₹100.00). Transactions are immutable.',
  },
  servers: [{ url: '/' }],
  tags: [{ name: 'Accounts' }, { name: 'Transactions' }, { name: 'Transfers' }],
  paths: {
    '/api/accounts': {
      post: {
        tags: ['Accounts'],
        summary: 'Create an account (balance starts at 0)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: ACCOUNT_NAME_MAX_LENGTH },
                },
              },
              example: { name: 'Alice' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Account created',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AccountResponse' } },
            },
          },
          '400': responses.ValidationError,
          '500': responses.InternalError,
        },
      },
    },
    '/api/accounts/{id}': {
      get: {
        tags: ['Accounts'],
        summary: 'Get account details and balance',
        parameters: [accountIdParam],
        responses: {
          '200': {
            description: 'Account found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AccountResponse' } },
            },
          },
          '400': responses.ValidationError,
          '404': responses.AccountNotFound,
          '500': responses.InternalError,
        },
      },
    },
    '/api/accounts/{id}/transactions': {
      post: {
        tags: ['Transactions'],
        summary: 'Create a credit or debit transaction',
        description:
          'The balance update and ledger entry are written atomically in one MongoDB transaction. ' +
          'Debits require sufficient funds.',
        parameters: [accountIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateTransactionRequest' },
              example: {
                type: 'credit',
                amount: 10000,
                referenceId: 'DEP-2024-0001',
                description: 'Cash deposit',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Transaction created and balance updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TransactionResultResponse' },
              },
            },
          },
          '400': responses.ValidationError,
          '404': responses.AccountNotFound,
          '409': {
            description: 'Insufficient funds or duplicate reference ID',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                examples: {
                  insufficient: {
                    value: {
                      success: false,
                      error: {
                        code: 'INSUFFICIENT_BALANCE',
                        message: 'The account has insufficient funds.',
                      },
                    },
                  },
                  duplicate: {
                    value: {
                      success: false,
                      error: {
                        code: 'DUPLICATE_REFERENCE',
                        message:
                          'A transaction with this reference ID already exists for the account.',
                      },
                    },
                  },
                },
              },
            },
          },
          '500': responses.InternalError,
        },
      },
      get: {
        tags: ['Transactions'],
        summary: 'List transactions (newest first, paginated)',
        parameters: [
          accountIdParam,
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: 10 },
          },
        ],
        responses: {
          '200': {
            description: 'A page of transactions sorted by createdAt desc, then _id desc',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TransactionPageResponse' },
              },
            },
          },
          '400': responses.ValidationError,
          '404': responses.AccountNotFound,
          '500': responses.InternalError,
        },
      },
    },
    '/api/transfers': {
      post: {
        tags: ['Transfers'],
        summary: 'Transfer money between two accounts atomically',
        description:
          'Debits the source and credits the destination in one MongoDB transaction, creating one ' +
          'debit and one credit ledger entry, both stored with referenceId "transfer:<referenceId>". ' +
          'Either everything is applied or nothing is. Repeating a request with the same ' +
          'referenceId returns 409 DUPLICATE_REFERENCE and moves no money.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateTransferRequest' },
              example: {
                sourceAccountId: '665f1c2e8b3a4d0012345678',
                destinationAccountId: '665f1c2e8b3a4d0012345679',
                amount: 3000,
                referenceId: 'TRANSFER-001',
                description: 'Transfer to another account',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Transfer completed',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/TransferResponse' } },
            },
          },
          '400': responses.ValidationError,
          '404': responses.AccountNotFound,
          '409': errorResponse(
            'Insufficient funds or duplicate transfer reference ID',
            'INSUFFICIENT_BALANCE',
            'The account has insufficient funds.',
          ),
          '500': responses.InternalError,
        },
      },
    },
  },
  components: {
    schemas: {
      Account: {
        type: 'object',
        properties: {
          _id: objectId,
          name: { type: 'string', example: 'Alice' },
          balance: { type: 'integer', minimum: 0, description: 'Minor currency units', example: 0 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Transaction: {
        type: 'object',
        properties: {
          _id: objectId,
          accountId: objectId,
          type: { type: 'string', enum: ['credit', 'debit'] },
          amount: { type: 'integer', minimum: 1, description: 'Minor currency units' },
          description: { type: 'string' },
          referenceId: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateTransactionRequest: {
        type: 'object',
        required: ['type', 'amount', 'referenceId'],
        properties: {
          type: { type: 'string', enum: ['credit', 'debit'] },
          amount: {
            type: 'integer',
            minimum: 1,
            description: 'Positive integer, minor currency units',
          },
          referenceId: {
            ...referenceIdProperty,
            description: `${referenceIdProperty.description} The "transfer:" prefix is reserved.`,
          },
          description: { type: 'string', maxLength: DESCRIPTION_MAX_LENGTH, default: '' },
        },
      },
      CreateTransferRequest: {
        type: 'object',
        required: ['sourceAccountId', 'destinationAccountId', 'amount', 'referenceId'],
        properties: {
          sourceAccountId: objectId,
          destinationAccountId: { ...objectId, description: 'Must differ from sourceAccountId' },
          amount: {
            type: 'integer',
            minimum: 1,
            description: 'Positive integer, minor currency units',
          },
          referenceId: referenceIdProperty,
          description: { type: 'string', maxLength: DESCRIPTION_MAX_LENGTH, default: '' },
        },
      },
      AccountResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { $ref: '#/components/schemas/Account' },
        },
      },
      TransactionResultResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              transaction: { $ref: '#/components/schemas/Transaction' },
              balance: { type: 'integer', description: 'Account balance after this transaction' },
            },
          },
        },
      },
      TransactionPageResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { $ref: '#/components/schemas/Transaction' } },
          pagination: {
            type: 'object',
            properties: {
              currentPage: { type: 'integer', example: 1 },
              pageSize: { type: 'integer', example: 10 },
              totalRecords: { type: 'integer', example: 42 },
              totalPages: { type: 'integer', example: 5 },
            },
          },
        },
      },
      TransferResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              referenceId: { type: 'string', example: 'TRANSFER-001' },
              amount: { type: 'integer', example: 3000 },
              debit: { $ref: '#/components/schemas/Transaction' },
              credit: { $ref: '#/components/schemas/Transaction' },
              sourceBalance: { type: 'integer' },
              destinationBalance: { type: 'integer' },
            },
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'INSUFFICIENT_BALANCE' },
              message: { type: 'string', example: 'The account has insufficient funds.' },
              details: {
                type: 'array',
                description: 'Present on VALIDATION_ERROR',
                items: {
                  type: 'object',
                  properties: { field: { type: 'string' }, message: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
};
