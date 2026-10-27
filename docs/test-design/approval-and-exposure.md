# Test design: approval and exposure

Endpoints: `POST /invoices/{invoiceId}/approve`, `GET /vendors/{vendorId}/exposure`.

Sources: `docs/API.md` (*Invoices*, *Vendors*, *Business rules*, *Errors*, *A full session with curl*); OpenAPI `POST /invoices/{invoiceId}/approve`, `GET /vendors/{vendorId}/exposure` (schemas `ApproveResult`, `GlEntry`, `VendorExposure`).

**Approval:** Reply **approved** or request changes. No test code until approved.

**Prerequisite setup (not under test):** Reach a **matched** invoice via `POST /purchase-orders` → submit → receive (as needed) → `POST /invoices` → `POST /invoices/{invoiceId}/match`, unless the row tests a wrong state (e.g. approve without match). Use unique `invoice_number` values per test.

---

## POST /invoices/{invoiceId}/approve

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| AE-A-01 | positive | Approve a matched invoice (full API.md example: PO fully received, invoice total 95.1) | 200 | `ApproveResult`: `invoice_id` matches; `status` `approved`; `gl_entry.balanced` true; debit `5000 Materials Expense` and credit `2000 Accounts Payable` each 95.1; `vendor_exposure` 95.1 | API.md approve example; rules 7, 11; OpenAPI `ApproveResult` | — |
| AE-A-02 | positive | After AE-A-01, `GET /vendors/{vendorId}/exposure` for that invoice’s vendor | 200 | `vendor_exposure` from approve equals `open_ap_liability`; `approved_invoices` includes the invoice id | API.md rule 11; OpenAPI `VendorExposure` | state |
| AE-A-03 | positive | Approve a second matched invoice for the **same vendor** (separate PO/invoice, e.g. another 47.5) | 200 | `vendor_exposure` equals **sum** of both approved `total_amount` values (95.1 + 47.5 = 142.6) | API.md rule 11 (`vendor_exposure_math`) | state |
| AE-A-E01 | error | `POST /invoices/inv-nope/approve` | 404 | `detail` present; **no** `rule` | OpenAPI 404 | — |
| AE-A-B01 | error | Approve invoice still in `received` (create invoice, **no** match) | 400 | `rule: three_way_match_gate` | API.md rule 4; OpenAPI approve description | state (wrong order) |
| AE-A-B02 | error | Approve the same invoice **twice** (second call after success) | 400 | `rule: duplicate_approval` | API.md rule 9; OpenAPI 400 description | state (done twice) |
| AE-A-A01 | assumed — ask | Approve when match was skipped but `matched` flag somehow true in edge cases | — | Exact gates beyond `three_way_match_gate` / status? | QUESTIONS.md §4 (workflow skips) | — |

**Business rules on approve:** 4 `three_way_match_gate`, 7 `gl_balance`, 9 `duplicate_approval`, 11 `vendor_exposure_math` (via `vendor_exposure` field and exposure GET).

---

## GET /vendors/{vendorId}/exposure

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| AE-E-01 | positive | `GET /vendors/vnd-001/exposure` when no invoices are **approved** for that vendor (fresh reset; only matched/received invoices allowed if created without approve) | 200 | `VendorExposure`: `vendor_id` `vnd-001`; `open_ap_liability` 0; `approved_invoices` `[]` | API.md rule 11; OpenAPI `VendorExposure` | — |
| AE-E-02 | positive | After approving one invoice (95.1) for `vnd-001` | 200 | `open_ap_liability` 95.1; `approved_invoices` length 1 containing that `inv-…` | API.md *Vendors* exposure example; rule 11 | state |
| AE-E-03 | positive | After two approved invoices on `vnd-001` (e.g. 95.1 and 47.5) | 200 | `open_ap_liability` 142.6; `approved_invoices` length 2 | API.md rule 11 (sum of `total_amount`) | state |
| AE-E-04 | positive | Invoice **matched** but not approved for `vnd-001`; then GET exposure | 200 | `open_ap_liability` still 0; unapproved invoice id **not** in `approved_invoices` | API.md rule 11 (approved only) | state |
| AE-E-05 | positive | `GET /vendors/vnd-002/exposure` (seed inactive vendor, no approvals) | 200 | `vendor_id` `vnd-002`; `open_ap_liability` 0 | API.md *Vendors* (404 only for unknown vendor); OpenAPI | — |
| AE-E-06 | positive | Approve invoice for `vnd-001`; `GET /vendors/vnd-002/exposure` unchanged | 200 | `vnd-002` exposure remains 0 — exposure is **per vendor** | API.md rule 11 | equivalence class |
| AE-E-E01 | error | `GET /vendors/vnd-nope/exposure` | 404 | `detail` present; **no** `rule` | API.md *Vendors*; OpenAPI 404 | — |
| AE-E-A01 | assumed — ask | Exposure when approved totals involve sub-cent rounding across multiple invoices | — | How is sum of `total_amount` rounded? | QUESTIONS.md §4 (fractional cents) | — |

---

## Cross-cutting notes for implementation

- Each test creates its own POs/invoices where possible so parallel runs stay isolated.
- Assert exact `rule` on every `400`; use `expectSchema` with `ApproveResult`, `VendorExposure`, or `Error`.
- Tag `{ tag: '@api' }` on each test; use `{ tag: '@e2e' }` only for a single chained happy path if you prefer one flow for AE-A-01 + AE-E-02 (optional—separate tests per row ID are fine).
- After approve, optional `GET /invoices/{invoiceId}` may show `status` `approved` (sanity check, not a separate design row).
