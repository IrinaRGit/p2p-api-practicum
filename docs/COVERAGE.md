# API test coverage (OpenAPI)

Generated from `/openapi.json` (same surface as the running API) and `tests/api/*.spec.ts`. Test types match `docs/test-design/`: **positive** (2xx success on the operation under test), **negative** (`400` validation / `validation_error`), **error** (`404` without `rule`, or design **error** rows: business-rule `400`s and workflow gates counted as error in those tables).

**Schema-checked:** every response body asserted in `@api` tests for that operation uses `expectSchema` (OpenAPI component schema or `Error`). Setup and meta tests noted separately.

Last full run reference: **119 passed**, **1 failed** (`npm run test:api`, parallel workers).

---

## Coverage by path and method

| Method | Path | Positive | Negative | Error | All responses schema-checked | Spec file(s) |
| --- | --- | ---: | ---: | ---: | --- | --- |
| POST | `/admin/reset` | 0 | 0 | 0 | No | `tests/api/reset.setup.ts` (setup only: status `200`, no body schema) |
| GET | `/health` | 1 | 0 | 0 | No | `tests/api/health.spec.ts` |
| GET | `/vendors` | 3 | 0 | 1 | Yes | `tests/api/vendors-and-catalog.spec.ts` (+ `tests/api/schema.spec.ts`: contract check on list items) |
| POST | `/vendors` | 4 | 6 | 0 | Yes | `tests/api/vendors-and-catalog.spec.ts` |
| GET | `/skus` | 2 | 0 | 1 | Yes | `tests/api/vendors-and-catalog.spec.ts` |
| POST | `/purchase-orders` | 6 | 14 | 2 | Yes | `tests/api/purchase-orders.spec.ts` |
| GET | `/purchase-orders/{poId}` | 2 | 0 | 1 | Yes | `tests/api/purchase-orders.spec.ts` |
| POST | `/purchase-orders/{poId}/submit` | 1 | 2 | 1 | Yes | `tests/api/purchase-orders.spec.ts` |
| POST | `/purchase-orders/{poId}/receive` | 8 | 9 | 6 | Yes | `tests/api/receipts.spec.ts` |
| POST | `/invoices` | 7 | 10 | 9 | Yes | `tests/api/invoices.spec.ts` |
| GET | `/invoices/{invoiceId}` | 2 | 0 | 1 | Yes | `tests/api/invoices.spec.ts` |
| POST | `/invoices/{invoiceId}/match` | 2 | 0 | 2 | Yes | `tests/api/invoices.spec.ts` |
| POST | `/invoices/{invoiceId}/approve` | 3 | 0 | 3 | Yes | `tests/api/approval-and-exposure.spec.ts` |
| GET | `/vendors/{vendorId}/exposure` | 6 | 0 | 1 | Yes | `tests/api/approval-and-exposure.spec.ts` |

**Totals (`@api` design-row tests on OpenAPI operations):** 47 positive · 41 negative · 28 error · **116** (plus 3 helper/meta tests in `schema.spec.ts`, 1 health test, 1 setup reset).

**Not OpenAPI operations (extra route tests):** `GET /vendors/extra`, `GET /skus/extra` → expect `404` + `Error` schema (`vendors-and-catalog.spec.ts`).

**Incidental calls (not counted above):** other specs call `POST /purchase-orders`, `submit`, `receive`, `POST /vendors`, etc. as setup for invoice/approve flows.

---

## Endpoints with zero in any column

| Method | Path | Zero column(s) | Notes |
| --- | --- | --- | --- |
| POST | `/admin/reset` | positive, negative, error | Only setup; no `@api` design-row tests |
| GET | `/health` | negative, error | Single happy-path test; no `expectSchema` (`Health` schema unused) |
| GET | `/vendors` | negative | GET has no request body to validate |
| POST | `/vendors` | error | No `404` case documented for create |
| GET | `/skus` | negative | Read-only list |
| GET | `/purchase-orders/{poId}` | negative | Read-only get-by-id |
| GET | `/invoices/{invoiceId}` | negative | Read-only get-by-id |
| POST | `/invoices/{invoiceId}/match` | negative | No validation-body failures exercised (empty body not applicable) |
| POST | `/invoices/{invoiceId}/approve` | negative | No body; failures are error-type gates only |
| GET | `/vendors/{vendorId}/exposure` | negative | No documented `400` for this operation |

---

## Possible bugs (strict docs oracle, failing runs)

| Test title | Operation | Expected (docs) | Observed | Doc reference |
| --- | --- | --- | --- | --- |
| `IN-C-B03 POST /invoices rejects case-insensitive duplicate invoice_number` | `POST /invoices` | `400`, `rule: duplicate_invoice_detection` for `INV-7` vs ` inv-7 ` (same vendor) | `201` (second invoice created) | `docs/API.md` business rule 6; OpenAPI `POST /invoices` description |

No other `@api` tests are currently failing against the documented oracle. Rows marked **assumed — ask** in test-design docs were never implemented (no pass/fail signal).

---

## Spec file index

| File | OpenAPI operations covered (primary tests) |
| --- | --- |
| `tests/api/reset.setup.ts` | `POST /admin/reset` (setup) |
| `tests/api/health.spec.ts` | `GET /health` |
| `tests/api/schema.spec.ts` | Helper/`GET /vendors` contract (meta) |
| `tests/api/vendors-and-catalog.spec.ts` | `GET /vendors`, `POST /vendors`, `GET /skus` |
| `tests/api/purchase-orders.spec.ts` | `POST /purchase-orders`, `GET /purchase-orders/{poId}`, `POST .../submit` |
| `tests/api/receipts.spec.ts` | `POST /purchase-orders/{poId}/receive` |
| `tests/api/invoices.spec.ts` | `POST /invoices`, `GET /invoices/{invoiceId}`, `POST .../match` |
| `tests/api/approval-and-exposure.spec.ts` | `POST /invoices/{invoiceId}/approve`, `GET /vendors/{vendorId}/exposure` |
