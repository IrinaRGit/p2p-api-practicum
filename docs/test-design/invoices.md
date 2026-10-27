# Test design: invoices (create, get, match)

Endpoints: `POST /invoices`, `GET /invoices/{invoiceId}`, `POST /invoices/{invoiceId}/match`.

Sources: `docs/API.md` (*Invoices*, *Purchase orders*, *Business rules*, *Errors*); OpenAPI `POST /invoices`, `GET /invoices/{invoiceId}`, `POST /invoices/{invoiceId}/match` (schemas `InvoiceCreate`, `Invoice`, `InvoiceLine`, `MatchResult`).

**Approval:** Reply **approved** or request changes. No test code until approved.

**Prerequisite setup (not under test):** Build POs with `POST /purchase-orders`, `POST .../submit`, and `POST .../receive` as each row requires. Use seed vendor `vnd-001` and catalog SKUs unless the row says otherwise. Use unique `invoice_number` values (e.g. suffix `Date.now()`) except where duplicate detection is under test.

---

## POST /invoices

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| IN-C-01 | positive | On a **closed** PO matching API.md example (10× LUM @ 4.75, 4× CEM @ 11.9, fully received): body from API.md with unique `invoice_number` | 201 | `Invoice`: `id` `inv-…`; `status` `received`; `matched` false; `partial_receipt` null; `total_amount` 95.1; lines match request | API.md *Invoices* example; OpenAPI `Invoice` | — |
| IN-C-02 | positive | Same lines on a **submitted** (not closed) PO that has received goods but is not fully received | 201 | `status` `received`; invoicing allowed on submitted PO | API.md rule 10 (submitted or closed); OpenAPI `POST /invoices` | state |
| IN-C-03 | positive | PO with one line, received 10; invoice only `{ "sku": "LUM-2X4-8", "quantity": 5, "unit_price": 4.75 }` | 201 | Partial qty invoice; `total_amount` 23.75 | API.md rule 3 (cumulative cap); OpenAPI description | — |
| IN-C-04 | positive | After IN-C-03 on same PO, second invoice for remaining 5 units (same SKU/price) | 201 | Second invoice created; cumulative qty equals received | API.md rule 3 (across invoices on one PO) | state |
| IN-C-05 | positive | One line, `quantity` 1 and `unit_price` 0 (minimums) on fully received PO | 201 | Accepts boundary minima; `total_amount` 0 | API.md shared line limits; OpenAPI `InvoiceLine` | boundary values |
| IN-C-06 | positive | One line, `quantity` 10000 and `unit_price` 100000 on PO ordered/received at those limits | 201 | Accepts boundary maxima | API.md (10,000 / 100,000) | boundary values |
| IN-C-07 | positive | Two vendors each with a PO; same `invoice_number` string for both (different `po_id`) | 201 | Both succeed — uniqueness is **per vendor** | API.md rule 6 (same vendor) | equivalence class |
| IN-C-N01 | negative | `{}` | 400 | `rule: validation_error`; `detail` mentions required fields | OpenAPI `InvoiceCreate` | equivalence class (missing fields) |
| IN-C-N02 | negative | `{ "po_id": "", "invoice_number": "INV-1", "line_items": [...] }` | 400 | `rule: validation_error` | OpenAPI `po_id` minLength 1 | equivalence class (empty string) |
| IN-C-N03 | negative | `{ "po_id": "po-1", "invoice_number": "", "line_items": [...] }` | 400 | `rule: validation_error` | OpenAPI `invoice_number` minLength 1 | equivalence class (empty string) |
| IN-C-N04 | negative | Missing `line_items` | 400 | `rule: validation_error` | OpenAPI `InvoiceCreate` | equivalence class (missing field) |
| IN-C-N05 | negative | `"line_items": []` | 400 | `rule: validation_error` | OpenAPI minItems 1 | boundary values (zero lines) |
| IN-C-N06 | negative | Line missing `sku` | 400 | `rule: validation_error` | OpenAPI `InvoiceLine` | equivalence class (missing field) |
| IN-C-N07 | negative | Line `"quantity": 0` | 400 | `rule: validation_error` | API.md line limits | boundary values |
| IN-C-N08 | negative | Line `"quantity": 10001` | 400 | `rule: validation_error` | API.md | boundary values (one over) |
| IN-C-N09 | negative | Line `"unit_price": -0.01` | 400 | `rule: validation_error` | API.md | equivalence class (negative number) |
| IN-C-N10 | negative | Malformed JSON body | 400 | `rule: validation_error`; invalid JSON in `detail` | API.md *Errors* | equivalence class (malformed body) |
| IN-C-E01 | error | `"po_id": "po-nope"` with otherwise valid body | 404 | `detail` present; **no** `rule` | OpenAPI 404 | — |
| IN-C-B01 | error | Invoice against PO still in **draft** (no submit) | 400 | `rule: workflow_gate` | API.md rule 10; OpenAPI | state (wrong order) |
| IN-C-B02 | error | Same vendor: first invoice `INV-1001`, second invoice `INV-1001` on another PO for that vendor | 400 | `rule: duplicate_invoice_detection` | API.md rule 6 | state |
| IN-C-B03 | error | First invoice `INV-7`, second `inv-7` (or ` INV-7 `) same vendor | 400 | `rule: duplicate_invoice_detection` | API.md rule 6 (case/space normalization) | equivalence class |
| IN-C-B04 | error | Line SKU not on the PO | 400 | `rule: invoice_line_validation` | API.md rule 8 | equivalence class |
| IN-C-B05 | error | Two lines with the same `sku` on one invoice | 400 | `rule: invoice_line_validation` | API.md rule 8 (once per invoice) | equivalence class (duplicate) |
| IN-C-B06 | error | PO submitted, **nothing received**; invoice qty 1 for a PO line | 400 | `rule: overpayment_protection` | API.md rule 3 (no tolerance) | state |
| IN-C-B07 | error | PO fully received 10× LUM @ 4.75; invoice 10× LUM @ 5.00 (total above received value) | 400 | `rule: overpayment_protection` | API.md rule 3 (total value) | boundary values |
| IN-C-B08 | error | Received 5 of 10; invoice 6 on that SKU | 400 | `rule: overpayment_protection` | API.md rule 3 (per line qty) | boundary values (one over received) |
| IN-C-A01 | assumed — ask | Partial invoicing edge cases beyond IN-C-03/04 (max invoices per PO?) | — | Any cap on number of invoices per PO? | QUESTIONS.md §4 (multiple invoices) | — |
| IN-C-A02 | assumed — ask | `"quantity": 10.5` on invoice line | — | Decimal quantities? | QUESTIONS.md §4 | — |
| IN-C-A03 | assumed — ask | Valid JSON without `Content-Type: application/json` | — | Status and `rule`? | QUESTIONS.md §4 | — |
| IN-C-A04 | assumed — ask | Unicode / internal whitespace variants in `invoice_number` beyond trim + ASCII case | — | Normalization rules? | QUESTIONS.md §4 | — |

---

## GET /invoices/{invoiceId}

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| IN-G-01 | positive | `GET /invoices/{invoiceId}` for an invoice just created (IN-C-01 shape) | 200 | Same as create response (`Invoice`, `status` `received`, `partial_receipt` null) | API.md; OpenAPI `GET /invoices/{invoiceId}` | state |
| IN-G-02 | positive | `GET` same id after successful `POST /invoices/{invoiceId}/match` | 200 | `status` `matched`; `matched` true; `partial_receipt` boolean (false when PO fully received) | API.md; OpenAPI `Invoice` | state |
| IN-G-E01 | error | `GET /invoices/inv-nope` | 404 | `detail` present; **no** `rule` | API.md *Errors*; OpenAPI 404 | — |

---

## POST /invoices/{invoiceId}/match

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| IN-M-01 | positive | Match invoice from IN-C-01 (fully received PO, full invoice) | 200 | `MatchResult`: `status` `matched`; `matched` true; `partial_receipt` false; `ordered_value` / `received_value` / `invoice_total` 95.1; `message` indicates pass | API.md match example; OpenAPI `MatchResult` | — |
| IN-M-02 | positive | PO with two lines; **partial receive** on first line only (second line received 0); invoice received lines only; then match | 200 | `partial_receipt` **true** (any PO line not fully received — rule 5); `message` references partial receipt | API.md rule 5; OpenAPI `partial_receipt_flag` | state |
| IN-M-E01 | error | `POST /invoices/inv-nope/match` | 404 | `detail` present; **no** `rule` | OpenAPI 404 | — |
| IN-M-B01 | error | Match after invoice **approved** (setup: create → match → `POST .../approve`, approve not under test) | 400 | `rule: workflow_gate` | API.md rule 10; OpenAPI match description | state (wrong status) |
| IN-M-A01 | assumed — ask | When 3-way match **fails** (totals/lines disagree) | — | Status, `rule`, and body? | QUESTIONS.md §4 (match failure) | — |
| IN-M-A02 | assumed — ask | Second `POST .../match` on already `matched` invoice (not approved) | — | Idempotent vs error? | QUESTIONS.md §4 (second match) | — |
| IN-M-A03 | assumed — ask | Must invoice `unit_price` equal PO line `unit_price` at match time? | — | Affects whether mismatch can fail match | QUESTIONS.md §4 | — |

**Business rules by endpoint**

| Endpoint | Rules exercised in this design |
| --- | --- |
| `POST /invoices` | 3 `overpayment_protection`, 6 `duplicate_invoice_detection`, 8 `invoice_line_validation`, 10 `workflow_gate` |
| `GET /invoices/{invoiceId}` | — |
| `POST .../match` | 5 `partial_receipt_flag` (via result), 10 `workflow_gate` (approved invoice) |

Rules 4, 7, 9, 11 apply to **approve** / exposure, out of scope here (except `approve` as setup for IN-M-B01).

---

## Cross-cutting notes for implementation

- Each test creates its own PO and invoices unless the row is an intentional follow-up (IN-C-04, IN-G-02).
- Assert exact `rule` on every `400`; use `expectSchema` with `Invoice`, `MatchResult`, or `Error`.
- Tag `{ tag: '@api' }` per test.
- IN-M-B01 may call `POST /invoices/{invoiceId}/approve` only as setup to reach `approved` status.
