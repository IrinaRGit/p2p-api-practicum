# Test design: receipts (goods received)

Endpoint: `POST /purchase-orders/{poId}/receive`.

Sources: `docs/API.md` (*Purchase orders*, *Business rules*, *Errors*); OpenAPI `POST /purchase-orders/{poId}/receive` (schema `ReceiveRequest`, response `PurchaseOrder`).

**Approval:** Reply **approved** or request changes. No test code until approved.

**Prerequisite setup (not under test):** Create a draft PO with `POST /purchase-orders`, then `POST /purchase-orders/{poId}/submit`, unless the row explicitly tests the wrong workflow state (e.g. draft).

---

## POST /purchase-orders/{poId}/receive

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| RC-P-01 | positive | On a submitted PO with one line (`LUM-2X4-8`, `quantity` 10): `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 10 }] }` | 200 | `PurchaseOrder`: line `received_quantity` 10; `received_value` 47.5; `fully_received` true; `status` `closed` | API.md receive example & close when fully received; OpenAPI description | — |
| RC-P-02 | positive | Submitted two-line PO (API.md example: 10× LUM, 4× CEM); receive only `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 10 }] }` | 200 | LUM line fully received; CEM `received_quantity` 0; `fully_received` false; `status` still `submitted`; `received_value` reflects LUM only (47.5) | API.md partial deliveries | — |
| RC-P-03 | positive | Same PO as RC-P-02 after RC-P-02: `{ "items": [{ "sku": "CEM-30KG", "quantity": 4 }] }` | 200 | Both lines fully received; `fully_received` true; `status` `closed`; `received_value` 95.1 | API.md (partial then complete); rule 2 cumulative cap | state |
| RC-P-04 | positive | Submitted PO with two lines; one request `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 10 }, { "sku": "CEM-30KG", "quantity": 4 }] }` | 200 | Full receipt in one delivery; `status` `closed` | API.md (every SKU on PO); OpenAPI `ReceiveRequest` | — |
| RC-P-05 | positive | Submitted PO, one line ordered 10: two receives `{ "quantity": 4 }` then `{ "quantity": 6 }` | 200 | After second call: `received_quantity` 10, `status` `closed` | API.md partial deliveries; rule 2 (across deliveries) | state |
| RC-P-06 | positive | One line ordered 1: `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 1 }] }` | 200 | Accepts minimum receive `quantity` (1) | API.md (same limits as PO lines); OpenAPI `quantity` | boundary values |
| RC-P-07 | positive | One line ordered 10000: receive `{ "quantity": 10000 }` | 200 | Accepts maximum receive `quantity` (10,000) | API.md (at most 10,000); OpenAPI `quantity` max | boundary values |
| RC-P-08 | positive | One request with duplicate SKU entries that sum within ordered qty: `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 3 }, { "sku": "LUM-2X4-8", "quantity": 2 }] }` on line ordered 10 | 200 | Single delivery totals 5 received on that line | OpenAPI `ReceiveRequest.items` array (per-item quantities) | equivalence class (aggregation in one payload) |
| RC-N-01 | negative | `{}` on a submitted PO | 400 | `rule: validation_error`; `detail` mentions `items` | OpenAPI `ReceiveRequest` required `items` | equivalence class (missing field) |
| RC-N-02 | negative | `{ "items": [] }` | 400 | `rule: validation_error`; at least one item | OpenAPI `items` minItems 1 | boundary values (zero items) |
| RC-N-03 | negative | Item missing `sku` | 400 | `rule: validation_error` | OpenAPI receive item required `sku` | equivalence class (missing field) |
| RC-N-04 | negative | `{ "items": [{ "sku": "   ", "quantity": 1 }] }` | 400 | `rule: validation_error`; SKU empty after trim | OpenAPI `sku` trim + min(1) | boundary values |
| RC-N-05 | negative | `"quantity": 0` | 400 | `rule: validation_error`; quantity must be > 0 | API.md; OpenAPI `quantity` | boundary values |
| RC-N-06 | negative | `"quantity": 10001` | 400 | `rule: validation_error`; over per-delivery max | API.md (at most 10,000) | boundary values (one over limit) |
| RC-N-07 | negative | `"quantity": -1` | 400 | `rule: validation_error` | OpenAPI `quantity` positive | equivalence class (negative number) |
| RC-N-08 | negative | `"quantity": "ten"` | 400 | `rule: validation_error`; wrong type | OpenAPI `quantity` number | equivalence class (wrong type) |
| RC-N-09 | negative | Malformed JSON body | 400 | `rule: validation_error`; invalid JSON in `detail` | API.md *Errors* | equivalence class (malformed body) |
| RC-E-01 | error | `POST /purchase-orders/po-nope/receive` with valid body | 404 | `detail` present; **no** `rule` | OpenAPI 404 | — |
| RC-B-01 | error | Receive on a **draft** PO (create only, no submit) | 400 | `rule: workflow_gate` | API.md rule 10; OpenAPI `workflow_gate` | state (wrong order) |
| RC-B-02 | error | Receive on a **closed** PO (setup: full receive to close, then receive again) | 400 | `rule: workflow_gate` | API.md rule 10; store only `submitted` accepts receive | state (wrong status) |
| RC-B-03 | error | Line ordered 10: `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 11 }] }` in one delivery | 400 | `rule: receive_quantity_limit` | API.md rule 2; OpenAPI description | boundary values (one over ordered) |
| RC-B-04 | error | Line ordered 10: receive 6, then receive 6 (cumulative 12) | 400 | Second response: `rule: receive_quantity_limit` | API.md rule 2 (across all deliveries) | state (cumulative over ordered) |
| RC-B-05 | error | Line ordered 10, already fully received (10): receive `{ "quantity": 1 }` again while PO still `submitted` (use a second line not yet received to keep PO open, or use single-line PO already closed — prefer multi-line: line A full, line B open; receive on line A again) | 400 | `rule: receive_quantity_limit` | API.md rule 2 | state (done twice on same line) |
| RC-A-01 | assumed — ask | `{ "items": [{ "sku": "NOT-ON-PO", "quantity": 1 }] }` | — | HTTP status and `rule` for SKU not on the PO? | QUESTIONS.md §4 (SKU not on PO) | — |
| RC-A-02 | assumed — ask | Repeat the **same** successful receive body twice when the first already applied (duplicate delivery) | — | Idempotent second call vs cumulative double-count? | QUESTIONS.md §4 (repeat receive) | — |
| RC-A-03 | assumed — ask | `"quantity": 10.5` | — | Decimal quantities allowed? | QUESTIONS.md §4 (decimal quantity) | — |
| RC-A-04 | assumed — ask | Valid JSON without `Content-Type: application/json` | — | Rejected or accepted? | QUESTIONS.md §4 (Content-Type) | — |
| RC-A-05 | assumed — ask | Receive payload that would push `received_value` into sub-cent rounding edge cases | — | How is `received_value` computed? | QUESTIONS.md §4 (fractional cents) | — |

**Business rules on this endpoint:** `workflow_gate` (rule 10), `receive_quantity_limit` (rule 2). Other rules (3–9, 11) do not apply to receive alone.

---

## Cross-cutting notes for implementation

- Each test builds its own PO (unique lines/qty as needed) so parallel runs do not share `{poId}`.
- Assert `rule` on every `400`; use `expectSchema` with `PurchaseOrder` or `Error`.
- Tag `{ tag: '@api' }` on each test; use `@e2e` only if a row intentionally chains many steps in one test title (prefer small setup + one assertion target per row ID).
