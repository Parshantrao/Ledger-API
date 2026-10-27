# Account Ledger API

A REST API for accounts, credit/debit transactions and money transfers, built with
**Node.js, Express 5, TypeScript, MongoDB (Mongoose), Zod, Jest/Supertest and Swagger**.

The focus is correctness: balances always equal the sum of the ledger. Every balance change and
its ledger entry are written in one MongoDB transaction. Concurrent debits cannot overdraw an
account, and a reference ID can never be applied twice.

---

## Quick start

**Prerequisites:** Node.js 20+ and Docker (for the local MongoDB replica set).

```bash
npm install
cp .env.example .env        # defaults match docker-compose.yml
npm run db:up               # MongoDB 7 single-node replica set on localhost:27017
npm run dev                 # http://localhost:3000, API docs at http://localhost:3000/api-docs
```

Production-style run: `npm run build && npm start`. Stop the database with `npm run db:down`.

> **Why a replica set?** Multi-document transactions are not supported on a standalone
> `mongod`. `docker-compose.yml` starts `mongod --replSet rs0`. Its healthcheck runs
> [`scripts/mongo-init-replica.js`](scripts/mongo-init-replica.js), which calls `rs.initiate()`
> on first start and reports healthy once the node is PRIMARY. You can also point `MONGODB_URI`
> at any existing replica set or MongoDB Atlas cluster.

### Scripts

| Script                            | Purpose                                                 |
| --------------------------------- | ------------------------------------------------------- |
| `npm run dev`                     | Start with auto-reload (tsx watch)                      |
| `npm run build` / `npm start`     | Compile to `dist/` / run compiled server                |
| `npm test`                        | Run the Jest + Supertest suite (starts its own MongoDB) |
| `npm run typecheck`               | `tsc --noEmit` over `src` and `tests` (strict mode)     |
| `npm run lint` / `lint:fix`       | ESLint (typescript-eslint)                              |
| `npm run format` / `format:check` | Prettier                                                |
| `npm run db:up` / `db:down`       | Start / stop the Docker MongoDB replica set             |

### Environment variables

| Variable           | Required | Default       | Description                                                             |
| ------------------ | -------- | ------------- | ----------------------------------------------------------------------- |
| `MONGODB_URI`      | yes      | –             | Replica-set connection string                                           |
| `PORT`             | no       | `3000`        | HTTP port                                                               |
| `NODE_ENV`         | no       | `development` | `development` \| `test` \| `production`                                 |
| `MONGODB_TEST_URI` | no       | –             | Run tests against an existing replica set (DB name must contain `test`) |

Environment variables are validated with Zod at startup (`src/config/env.ts`). `.env` is git-ignored.

---

## Architecture

A class-based, layered design. Each layer has one responsibility, and dependencies point inwards
through constructor injection.

```
HTTP request
  → Router            (routes only; no logic)
  → Controller        parses params/query/body with Zod, calls a service, shapes the JSON response
  → Service           business rules + owns the MongoDB session/transaction
  → Repository        the only code that touches Mongoose models (implements an interface)
  → Mongoose Model    schema, constraints, indexes
Errors at any layer → central error middleware → { success: false, error: { code, message } }
```

```
src/
  app.ts                     composition root: builds repositories → services → controllers → routes
  server.ts                  loads env, connects to MongoDB, starts HTTP server, graceful shutdown
  config/  env.ts            Zod-validated environment
           database.ts       connect/disconnect, index sync, shared transaction options
  docs/    openapi.ts        OpenAPI 3 spec served at /api-docs
  errors/  AppError.ts       the single application error class (status, code, safe message)
  interfaces/                IAccountRepository, ITransactionRepository
  middleware/                error + unknown-route handlers
  modules/
    accounts/                model, repository, service, controller, routes, validator
    transactions/            model, repository, service, controller, routes, validator
    transfers/               service, controller, routes, validator (reuses the transaction module)
tests/                       accounts, transactions, integrity, transfers, app (+ helpers, setup)
```

## Atomicity and concurrency

Creating a transaction (`TransactionService.createTransaction`):

1. `startSession()` → `session.withTransaction(..., { readConcern: snapshot, writeConcern: majority })`
2. Load the account in the session → **404** if missing.
3. Check the `(accountId, referenceId)` pair is unused → **409 `DUPLICATE_REFERENCE`**.
4. Update the balance:
   - credit: `$inc: { balance: +amount }`
   - debit: `findOneAndUpdate({ _id, balance: { $gte: amount } }, { $inc: { balance: -amount } })`.
     The check and the write are **one atomic operation**. If no document matches, the account
     is known to exist (step 2), so the result is **409 `INSUFFICIENT_BALANCE`**.
5. Insert the ledger entry in the same session. The unique index catches any race that slipped
   past step 3 (E11000 → 409 `DUPLICATE_REFERENCE`).
6. The commit happens only if every step succeeded. Any thrown error aborts the transaction, so
   **no balance change without a ledger entry, and no ledger entry without a balance change**.
7. `endSession()` always runs in `finally`.

Every call inside a transaction is awaited in sequence on the session (no `Promise.all`). The
response is sent only after `withTransaction` resolves, which is after the commit.

**Why atomic?** The balance and the ledger live in two collections. Without a transaction, a
crash or error between the two writes would leave money that appears from nowhere, or a ledger
entry for money that never moved.

**Concurrent debits.** Two transactions updating the same account document conflict. MongoDB
aborts one with a `TransientTransactionError` (write conflict). The driver's `withTransaction`
then re-runs the callback against fresh data, and the conditional debit rejects the overdraft.
This retry is safe because an aborted attempt leaves no writes, and the unique reference index
means an operation can never be applied twice. There is no hand-written retry loop. The test
suite fires 10 concurrent debits of 30 at a balance of 100: exactly 3 succeed and the balance
ends at 10.

**Transfers** (`TransferService.transfer`) run in one session: check both accounts exist, apply
the debit leg on the source, then the credit leg on the destination. If either leg fails
(insufficient funds, duplicate, write error), the whole transaction aborts, so there is never a
partial transfer.

---

## API

Interactive docs: **`/api-docs`** (Swagger UI). Raw spec: `/api-docs.json`.

| Method | Path                             | Description                            | Success |
| ------ | -------------------------------- | -------------------------------------- | ------- |
| POST   | `/api/accounts`                  | Create account (balance starts at 0)   | 201     |
| GET    | `/api/accounts/:id`              | Get account and balance                | 200     |
| POST   | `/api/accounts/:id/transactions` | Create a credit or debit               | 201     |
| GET    | `/api/accounts/:id/transactions` | History, newest first, `?page=&limit=` | 200     |
| POST   | `/api/transfers`                 | Atomic transfer between two accounts   | 201     |

There are intentionally **no** endpoints to update or delete transactions, or to set a balance.
Unknown routes, including `PUT/PATCH/DELETE` on these paths, return `404 ROUTE_NOT_FOUND`.

### Sample calls

```bash
BASE=http://localhost:3000/api

# Create an account
curl -s -X POST $BASE/accounts -H 'Content-Type: application/json' -d '{"name":"Alice"}'
# → 201 {"success":true,"data":{"_id":"<ID>","name":"Alice","balance":0,"createdAt":"…","updatedAt":"…"}}

# Credit ₹100.00 (10000 paise)
curl -s -X POST $BASE/accounts/<ID>/transactions -H 'Content-Type: application/json' \
  -d '{"type":"credit","amount":10000,"referenceId":"DEP-1","description":"Deposit"}'
# → 201 {"success":true,"data":{"transaction":{…},"balance":10000}}

# Debit, then repeat the same request
curl -s -X POST $BASE/accounts/<ID>/transactions -H 'Content-Type: application/json' \
  -d '{"type":"debit","amount":2500,"referenceId":"PAY-1"}'
# → 201 first time; 409 DUPLICATE_REFERENCE on repeat (balance unchanged)

# History (page 1, 10 per page)
curl -s "$BASE/accounts/<ID>/transactions?page=1&limit=10"
# → 200 {"success":true,"data":[…],"pagination":{"currentPage":1,"pageSize":10,"totalRecords":2,"totalPages":1}}

# Transfer ₹30.00
curl -s -X POST $BASE/transfers -H 'Content-Type: application/json' -d '{
  "sourceAccountId":"<ID>","destinationAccountId":"<OTHER_ID>",
  "amount":3000,"referenceId":"TRANSFER-001","description":"Transfer to another account"}'
# → 201 {"success":true,"data":{"referenceId":"TRANSFER-001","amount":3000,"debit":{…},"credit":{…},
#        "sourceBalance":4500,"destinationBalance":3000}}
```

### Errors

All errors use one shape. `details` is included for validation errors:

```json
{
  "success": false,
  "error": { "code": "INSUFFICIENT_BALANCE", "message": "The account has insufficient funds." }
}
```

| Status | Code                   | When                                                          |
| ------ | ---------------------- | ------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`     | Invalid body/params/query, malformed ObjectId, bad pagination |
| 400    | `INVALID_REQUEST_BODY` | Malformed JSON                                                |
| 404    | `ACCOUNT_NOT_FOUND`    | Account (or transfer source/destination) does not exist       |
| 404    | `ROUTE_NOT_FOUND`      | Unknown route or method                                       |
| 409    | `INSUFFICIENT_BALANCE` | Debit/transfer larger than the balance                        |
| 409    | `DUPLICATE_REFERENCE`  | Reference ID already used for this account                    |
| 500    | `INTERNAL_ERROR`       | Anything unexpected (no stack traces or DB details exposed)   |

---

## Testing

```bash
npm test
```

- Jest's `globalSetup` starts a **real single-node MongoDB replica set** using
  `mongodb-memory-server` (the binary is downloaded on first run). Transactions, write conflicts,
  rollbacks and unique indexes are exercised for real, not mocked.
- To use the Docker database instead:
  `MONGODB_TEST_URI="mongodb://localhost:27017/account_ledger_test?replicaSet=rs0" npm test`.
  As a safety check, the database name must contain `test`, because tests delete all documents.
- Rollback tests inject a failure into one repository call (e.g. the ledger insert after the
  balance update has run) and then check that MongoDB rolled back every write.

| File                   | Covers                                                                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts.test.ts`     | create, blank/missing/non-string names, retrieval, malformed vs unknown IDs                                                                                                                                                         |
| `transactions.test.ts` | credit/debit, balance arithmetic, validation (type/amount/reference/description), 404, insufficient funds, duplicates, per-account references, ordering + tie-break, pagination metadata and validation, no update/delete endpoints |
| `integrity.test.ts`    | rollback on ledger write failure (credit and debit), unique-index fallback, no partial state, 10 concurrent debits, concurrent duplicate requests                                                                                   |
| `transfers.test.ts`    | successful transfer, validation, 404 source/destination, insufficient funds, rollback when the credit leg fails, repeated and concurrent identical transfers                                                                        |
| `app.test.ts`          | 404 handler, malformed JSON, Swagger docs                                                                                                                                                                                           |

---

## Assumptions

- **Currency units.** All amounts and balances are integers in minor units (e.g. paise; `10000`
  = ₹100.00). Amounts must be positive safe integers. JSON strings such as `"100"` and
  fractional values are rejected. Single currency.
- **Balances** start at 0, cannot be set by clients, and can never go negative.
- **Reference IDs** are client-generated idempotency keys: required, trimmed, 1–100 characters,
  and **unique per account** (the same ID may be used on different accounts). They are
  case-sensitive.
- **Duplicate handling.** Reusing a reference ID on the same account returns
  `409 DUPLICATE_REFERENCE` and has no effect. The original transaction is not returned, and
  this answer is consistent even if the balance has changed since. A request that _failed_
  (for example a 409 for insufficient funds, or a 500) wrote nothing, so the same reference ID
  can be retried.
- **Description** is optional, a string of up to **255 characters** (trimmed), and defaults to `""`.
- **Account name** is required and must be 1–100 characters after trimming.
- **Pagination.** `page` ≥ 1 (default 1) and `limit` 1–**100** (default 10), digits only. Pages
  beyond the end return an empty `data` array. Order is `createdAt` desc, then `_id` desc.
- **Transfer idempotency.** The client supplies a `referenceId` per logical transfer. Both legs
  are stored with referenceId **`transfer:<referenceId>`**: a debit on the source and a credit
  on the destination, which also links the two legs. Because the unique index is per account,
  repeating a transfer collides on the source leg and returns `409 DUPLICATE_REFERENCE` with no
  money moved. Reusing the reference into the same destination from another source collides on
  the credit leg and is fully rolled back. The `transfer:` prefix is reserved: the transactions
  endpoint rejects it so clients cannot occupy a transfer's key. Clients should treat transfer
  reference IDs as globally unique.
- Transfers between the same account are rejected (`400`). ObjectIds are compared
  case-insensitively.
- Out of scope, as the brief requests: authentication, multi-currency, and returning the
  original response for duplicate requests.

## Implementation notes

- The MongoDB Node driver v7 loads `os` via dynamic `import()`, which Jest's VM sandbox does not
  support. Without help, the driver sends an empty handshake and the server rejects it. The test
  helper passes the driver's public `runtimeAdapters: { os }` option, so production code is
  unaffected.
- Transaction ledger fields are also marked `immutable` in the Mongoose schema, as a second
  layer of protection beyond having no update endpoints.
