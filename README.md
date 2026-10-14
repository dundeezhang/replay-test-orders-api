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

- `GET /v1/orders` - list orders, newest first
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

## Development

- `npm run typecheck` - type-check without emitting
- `npm run build` - compile to `dist/`
- `npm test` - run the vitest suite
