# Test design: purchase orders (create, get, submit)

Endpoints: `POST /purchase-orders`, `GET /purchase-orders/{poId}`, `POST /purchase-orders/{poId}/submit`.

Sources: `docs/API.md` (*Purchase orders*, *Seed data*, *Business rules*, *Errors*); OpenAPI `POST /purchase-orders`, `GET /purchase-orders/{poId}`, `POST /purchase-orders/{poId}/submit` (schemas `PurchaseOrderCreate`, `PoLineCreate`, `PurchaseOrder`).

**Approval:** Reply **approved** or request changes. No test code until approved.

---

## POST /purchase-orders

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| PO-C-01 | positive | `{ "vendor_id": "vnd-001", "line_items": [ { "sku": "LUM-2X4-8", "description": "2x4 stud, 8 ft", "quantity": 10, "unit_price": 4.75 }, { "sku": "CEM-30KG", "quantity": 4, "unit_price": 11.9 } ] }` | 201 | `PurchaseOrder`: `id` matches `po-…`; `vendor_id` `vnd-001`; `status` `draft`; lines include `received_quantity: 0`; second line `description` `""`; `ordered_value` 95.1; `received_value` 0; `fully_received` false | API.md *Purchase orders* example; OpenAPI `PurchaseOrder` | — |
| PO-C-02 | positive | One line, omit `description`: `{ "vendor_id": "vnd-001", "line_items": [{ "sku": "LUM-2X4-8", "quantity": 1, "unit_price": 4.75 }] }` | 201 | `description` `""` on line; `ordered_value` 4.75 | OpenAPI `PoLineCreate` (`description` default) | — |
| PO-C-03 | positive | `{ "vendor_id": "vnd-001", "line_items": [{ "sku": "LUM-2X4-8", "quantity": 1, "unit_price": 4.75 }] }` | 201 | Accepts smallest valid `quantity` (1) | API.md (quantity > 0); OpenAPI `quantity` minimum | boundary values |
| PO-C-04 | positive | Same with `"quantity": 10000` | 201 | Accepts max valid `quantity` (10,000) | API.md (at most 10,000); OpenAPI `quantity` max | boundary values |
| PO-C-05 | positive | One line with `"unit_price": 0` | 201 | Accepts min valid `unit_price` (0); `ordered_value` 0 | API.md (0 to 100,000); OpenAPI `unit_price` | boundary values |
| PO-C-06 | positive | One line with `"unit_price": 100000` and `"quantity": 1` | 201 | Accepts max valid `unit_price` (100,000); `ordered_value` 100000 | API.md; OpenAPI `unit_price` max | boundary values |
| PO-C-N01 | negative | `{}` | 400 | `rule: validation_error`; `detail` mentions `vendor_id` and/or `line_items` | OpenAPI `PurchaseOrderCreate` required fields | equivalence class (missing fields) |
| PO-C-N02 | negative | `{ "vendor_id": "", "line_items": [{ "sku": "LUM-2X4-8", "quantity": 1, "unit_price": 1 }] }` | 400 | `rule: validation_error`; empty `vendor_id` rejected | OpenAPI `vendor_id` minLength 1 | equivalence class (empty string) |
| PO-C-N03 | negative | `{ "vendor_id": "vnd-001" }` (no `line_items`) | 400 | `rule: validation_error`; missing `line_items` | OpenAPI `PurchaseOrderCreate` | equivalence class (missing field) |
| PO-C-N04 | negative | `{ "vendor_id": "vnd-001", "line_items": [] }` | 400 | `rule: validation_error`; at least one line required | API.md (every line needs…); OpenAPI `line_items` minItems 1 | boundary values (zero lines) |
| PO-C-N05 | negative | Line missing `sku` | 400 | `rule: validation_error` | OpenAPI `PoLineCreate` required `sku` | equivalence class (missing field) |
| PO-C-N06 | negative | Line `{ "sku": "   ", "quantity": 1, "unit_price": 1 }` | 400 | `rule: validation_error`; SKU empty after trim | OpenAPI `PoLineCreate.sku` trim + min(1) | boundary values |
| PO-C-N07 | negative | `"quantity": 0` | 400 | `rule: validation_error`; quantity must be > 0 | API.md; OpenAPI `quantity` exclusiveMinimum | boundary values |
| PO-C-N08 | negative | `"quantity": 10001` | 400 | `rule: validation_error`; over max quantity | API.md (at most 10,000) | boundary values (one over limit) |
| PO-C-N09 | negative | `"quantity": -1` | 400 | `rule: validation_error` | OpenAPI `quantity` positive | equivalence class (negative number) |
| PO-C-N10 | negative | `"unit_price": -0.01` | 400 | `rule: validation_error` | API.md (0 to 100,000); OpenAPI nonnegative | equivalence class (negative number) |
| PO-C-N11 | negative | `"unit_price": 100001` | 400 | `rule: validation_error`; over max price | API.md | boundary values (one over limit) |
| PO-C-N12 | negative | Two lines with the same `sku` | 400 | `rule: validation_error`; duplicate SKU on one PO | API.md (each SKU once); OpenAPI `POST /purchase-orders` description | equivalence class (duplicate) |
| PO-C-N13 | negative | `"quantity": "ten"` (string) | 400 | `rule: validation_error`; wrong type | OpenAPI `PoLineCreate.quantity` number | equivalence class (wrong type) |
| PO-C-N14 | negative | Malformed JSON body | 400 | `rule: validation_error`; invalid JSON in `detail` | API.md *Errors*; Express JSON parser | equivalence class (malformed body) |
| PO-C-E01 | error | `"vendor_id": "vnd-nope"` with valid lines | 404 | `detail` present; **no** `rule` | API.md (vendor must exist); OpenAPI 404 | — |
| PO-C-B01 | error | `"vendor_id": "vnd-002"` (seed inactive vendor) with valid lines | 400 | `rule: inactive_vendor_gate` | API.md rule 1; OpenAPI `inactive_vendor_gate` | — |
| PO-C-A01 | assumed — ask | Two identical `POST /purchase-orders` bodies in a row | — | New PO each time, or idempotent? | QUESTIONS.md §4 (duplicate POST PO) | — |
| PO-C-A02 | assumed — ask | Line with `"quantity": 10.5` | — | Are decimal quantities allowed? | QUESTIONS.md §4 (whole vs decimal quantity) | — |
| PO-C-A03 | assumed — ask | Valid JSON without `Content-Type: application/json` | — | Rejected or accepted? Status and `rule`? | QUESTIONS.md §4 (Content-Type) | — |
| PO-C-A04 | assumed — ask | Lines whose `quantity × unit_price` needs sub-cent rounding | — | How is `ordered_value` rounded? | QUESTIONS.md §4 (fractional cents) | — |

**Note:** Docs do not require SKU to exist in `GET /skus` catalog for PO creation; no catalog-membership cases unless product adds that rule.

---

## GET /purchase-orders/{poId}

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| PO-G-01 | positive | `GET /purchase-orders/{poId}` where `{poId}` came from a successful `POST /purchase-orders` (PO-C-01 body) | 200 | Same shape and field values as that create response (`PurchaseOrder`, still `draft`) | API.md (“same shape”); OpenAPI `GET /purchase-orders/{poId}` | state |
| PO-G-02 | positive | `GET` the same `{poId}` after `POST /purchase-orders/{poId}/submit` | 200 | `status` `submitted`; lines and values unchanged from draft except status | API.md *Purchase orders*; OpenAPI `PurchaseOrder` | state |
| PO-G-E01 | error | `GET /purchase-orders/po-nope` | 404 | `detail` present; **no** `rule` | API.md *Errors*; OpenAPI 404 | — |

---

## POST /purchase-orders/{poId}/submit

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| PO-S-01 | positive | `POST /purchase-orders/{poId}/submit` on a draft PO (from PO-C-02 or similar) | 200 | `PurchaseOrder` with `status` `submitted`; `ordered_value` / lines unchanged | API.md (draft → submitted); OpenAPI submit 200 | — |
| PO-S-E01 | error | `POST /purchase-orders/po-nope/submit` | 404 | `detail` present; **no** `rule` | OpenAPI 404 | — |
| PO-S-N01 | negative | `POST .../submit` a second time on the same PO (already `submitted`) | 400 | `rule: workflow_gate`; not draft | API.md (anything else rejected, rule 10); OpenAPI submit description | state (done twice) |
| PO-S-N02 | negative | `POST .../submit` when PO is `closed` (setup: create → submit → `POST .../receive` until fully received — receive is setup only, not under test here) | 400 | `rule: workflow_gate` | API.md rule 10; OpenAPI `workflow_gate` | state (wrong status) |
| PO-S-A01 | assumed — ask | Second submit after first succeeded — same as PO-S-N01? | — | Exact status/`detail` if docs disagree with PO-S-N01 | QUESTIONS.md §4 (submit twice) | — |

**Business rules on this endpoint:** `workflow_gate` (rule 10) only. Rules 2–9 and 11 do not apply to create/get/submit in isolation.

---

## Cross-cutting notes for implementation

- Suite setup: `POST /admin/reset` once; use seed `vnd-001` / `vnd-002` and catalog SKUs from API.md where noted.
- Prefer creating a dedicated active vendor only when a test must not depend on seed PO side effects; most create cases can use `vnd-001`.
- Assert `rule` on every `400`; validate bodies with OpenAPI `PurchaseOrder` or `Error`.
- Tests for PO-S-N02 may call `POST /purchase-orders/{poId}/receive` only as prerequisite setup, tagged separately or documented in test title as setup step.
