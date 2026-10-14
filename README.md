# orders-api

HTTP service that manages the product catalog, inventory and orders for
storefront merchants. Every request is scoped to the merchant that owns the API
key used to authenticate it.

Storage is in-memory for now (see `src/repositories`); the repository
interfaces are async so they can be swapped for a database-backed
implementation without touching the services or routes.

## Getting started

```sh
npm install
cp .env.example .env   # then fill in real API keys
npm run dev
```

Run the test suite with `npm test`.

## Configuration

| Variable         | Default       | Description                                                   |
| ---------------- | ------------- | ------------------------------------------------------------- |
| `PORT`           | `3000`        | Port the HTTP server listens on.                              |
| `NODE_ENV`       | `development` | `development`, `test` or `production`.                        |
| `LOG_LEVEL`      | `info`        | Minimum log level written to stdout.                          |
| `API_KEYS`       | (empty)       | Comma-separated `merchantId:role:key` entries. Required in production. |
| `RESERVATION_TTL_SECONDS` | `900` | How long checkout holds stock for an unpaid order. |
| `RESERVATION_SWEEP_INTERVAL_MS` | `15000` | How often expired reservations are released. |
| `SEED_DEMO_DATA` | `false`       | Seed a demo catalog for every configured merchant on startup. |
| `WEBHOOK_TIMEOUT_MS` | `5000` | Per-attempt timeout for webhook deliveries. |
| `WEBHOOK_MAX_ATTEMPTS` | `8` | Attempts before a delivery is marked failed. |
| `WEBHOOK_POLL_INTERVAL_MS` | `1000` | How often the delivery worker looks for due deliveries. |

## Authentication

Send the API key as a bearer token:

```
Authorization: Bearer <api key>
```

Keys have one of two roles. `staff` keys can read the catalog and create or
cancel orders; `admin` keys can additionally manage products and mark orders as
paid.

## API

All responses are JSON. Successful responses wrap the payload in `data`.

### Products

- `GET /v1/products` - list products
- `GET /v1/products/:id` - fetch a product
- `POST /v1/products` - create a product (admin)
- `PATCH /v1/products/:id` - update name, price, stock or active flag (admin)

### Orders

- `GET /v1/orders` - list orders, newest first. Supports:
  - `page` (default `1`) and `pageSize` (default `25`, max `100`)
  - `status` - one or more comma-separated statuses, e.g. `status=pending,paid`
  - `customerId` - only orders for this customer
  - `createdFrom` / `createdTo` - inclusive date range, `YYYY-MM-DD`
  - `sort` - `createdAt`, `-createdAt` (default), `totalCents` or `-totalCents`

  The response includes a `pageInfo` object with `totalItems`, `totalPages`,
  `hasNextPage` and `hasPreviousPage`.
- `GET /v1/orders/:id` - fetch an order
- `POST /v1/orders` - create a pending order from catalog prices
- `POST /v1/orders/:id/pay` - mark an order as paid (admin)
- `POST /v1/orders/:id/cancel` - cancel a pending or paid order

All money values are integer cents in the order's currency. Prices are always
taken from the catalog at the time the order is created; clients cannot submit
their own prices.

### Checkout and inventory

- `POST /v1/orders/:id/checkout` - reserve stock, charge `paymentMethodToken`,
  then commit the stock and mark the order paid
- `GET /v1/inventory/:productId` - on-hand, reserved and available quantity
- `GET /v1/reservations/:id` - fetch a reservation

Checkout places a reservation on every line of the order before charging. A
declined or failed payment releases the reservation immediately; abandoned
reservations are released by a background sweeper once they pass
`RESERVATION_TTL_SECONDS`. Payment failures return `402 payment_declined` or
`503 payment_unavailable`; a stock shortfall returns `409` with the affected
SKUs in `details.shortages`.

In development the fake payment gateway accepts any token except
`pm_card_declined`, `pm_insufficient_funds` and `pm_gateway_timeout`.

## Errors

Errors use a consistent envelope:

```json
{ "error": { "code": "validation_error", "message": "Request validation failed", "requestId": "..." } }
```

Every response carries an `x-request-id` header; include it when reporting
problems.

## Webhooks

Admins can register HTTPS endpoints to be notified about order lifecycle
events (`order.created`, `order.paid`, `order.cancelled`):

- `GET /v1/webhooks` - list endpoints
- `POST /v1/webhooks` - register an endpoint `{ url, events, description? }`
- `GET /v1/webhooks/:id` / `PATCH /v1/webhooks/:id` / `DELETE /v1/webhooks/:id`
- `GET /v1/webhooks/:id/deliveries` - recent delivery attempts
- `POST /v1/webhooks/:id/deliveries/:deliveryId/retry` - re-queue a failed delivery

The response to `POST /v1/webhooks` contains the endpoint's signing `secret`.
It is not returned again, so store it securely.

Each delivery is a JSON `POST` with an `x-orders-signature` header of the form
`t=<unix seconds>,v1=<hex>`, where the hex value is the HMAC-SHA256 of
`<t>.<raw body>` keyed with the endpoint secret. Reject deliveries whose
timestamp is more than five minutes old. See `verifySignature` in
`src/webhooks/signing.ts` for a reference implementation.

Any `2xx` response acknowledges a delivery. Timeouts, network errors, `408`,
`429` and `5xx` responses are retried with exponential backoff (starting at
30 seconds, capped at one hour) up to `WEBHOOK_MAX_ATTEMPTS`; other `4xx`
responses fail the delivery immediately.

## Development

- `npm run typecheck` - type-check without emitting
- `npm run build` - compile to `dist/`
- `npm test` - run the vitest suite
