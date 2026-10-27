# API.md vs OpenAPI — inspection notes

Sources: `docs/API.md` and `GET http://localhost:8000/openapi.json` (same document as `/docs`). No endpoints were called except that GET. `src/` was not read.

---

## 1. In both documents

Facts both sources state (one line each, with where).

- Base URL is `http://localhost:8000`. — **inspected only** — API.md *Basics*; OpenAPI `servers[0].url`.
- There is no authentication. — **inspected only** — API.md *Basics*; OpenAPI `info.description`.
- Data is kept in memory and returns to seed state after a restart or `POST /admin/reset`. — **inspected only** — API.md *Basics*, *Seed data*; OpenAPI `info.description`, `POST /admin/reset`.
- Requests and responses use JSON (`application/json` on documented bodies). — **inspected only** — API.md *Basics*; OpenAPI path `requestBody` / response `content` types.
- Money is expressed in dollars and rounded to cents (two decimal places). — **inspected only** — API.md *Basics* (*Money*); OpenAPI amount field descriptions (e.g. `VendorExposure`, `PoLine`, `MatchResult`).
- Failed requests return a JSON body with a human-readable `detail`. — **inspected only** — API.md *Errors*; OpenAPI schema `Error`, `info.description`.
- Business-rule and validation failures include a `rule` field; `404` responses do not include `rule`. — **inspected only** — API.md *Errors*; OpenAPI `Error.rule`, `info.description`.
- Success uses `200`; creating a vendor, PO, or invoice uses `201`; invalid input or rejected rules use `400`; missing records use `404`. — **inspected only** — API.md *Errors*; OpenAPI operation `responses`.
- The `rule` values include `inactive_vendor_gate`, `receive_quantity_limit`, `overpayment_protection`, `three_way_match_gate`, `partial_receipt_flag`, `duplicate_invoice_detection`, `gl_balance`, `invoice_line_validation`, `duplicate_approval`, `workflow_gate`, `vendor_exposure_math`, and `validation_error`. — **inspected only** — API.md *Errors*, *Business rules*; OpenAPI schema `Error.properties.rule.enum`.
- `GET /health` returns `{ "status": "ok" }`. — **inspected only** — API.md *System*; OpenAPI `GET /health`, schema `Health`.
- `POST /admin/reset` clears POs, invoices, and created vendors, restores seed data, and returns `{ "status": "reset" }`. — **inspected only** — API.md *System*; OpenAPI `POST /admin/reset`, schema `Reset`.
- `GET /vendors` lists vendors; `POST /vendors` creates a vendor and returns `201`. — **inspected only** — API.md *Vendors*; OpenAPI `GET /vendors`, `POST /vendors`.
- Vendor create requires non-empty `name`; `active` is optional and defaults to `true`. — **inspected only** — API.md *Vendors*; OpenAPI schema `VendorCreate`.
- `GET /vendors/{vendorId}/exposure` returns what the business owes that vendor; unknown vendors yield `404`. — **inspected only** — API.md *Vendors*; OpenAPI `GET /vendors/{vendorId}/exposure`.
- Vendor exposure (`open_ap_liability` / `vendor_exposure_math`) is the sum of `total_amount` over that vendor’s approved invoices. — **inspected only** — API.md *Business rules* (#11), *Vendors* exposure example; OpenAPI `GET /vendors/{vendorId}/exposure.description`, schema `VendorExposure`.
- `GET /skus` lists the SKU catalog. — **inspected only** — API.md *Catalog*; OpenAPI `GET /skus`.
- Purchase order statuses are `draft`, `submitted`, and `closed`. — **inspected only** — API.md *The purchase-to-pay flow*; OpenAPI schema `PurchaseOrder.properties.status.enum`.
- Invoice statuses are `received`, `matched`, and `approved`. — **inspected only** — API.md *The purchase-to-pay flow*; OpenAPI schema `Invoice.properties.status.enum`.
- `POST /purchase-orders` creates a draft PO (`201`); missing vendor `404`; inactive vendor rejected (`inactive_vendor_gate`). — **inspected only** — API.md *Purchase orders*; OpenAPI `POST /purchase-orders`.
- Each PO line needs `sku`, `quantity` (greater than 0, at most 10,000), and `unit_price` (0 through 100,000); `description` is optional. — **inspected only** — API.md *Purchase orders*; OpenAPI schema `PoLineCreate`.
- Each SKU may appear only once on a PO. — **inspected only** — API.md *Purchase orders*; OpenAPI `POST /purchase-orders.description`.
- A PO response includes `ordered_value`, `received_value`, `fully_received`, and per-line `received_quantity`. — **inspected only** — API.md *Purchase orders*; OpenAPI schemas `PurchaseOrder`, `PoLine`.
- `GET /purchase-orders/{poId}` returns a PO in that shape; unknown PO `404`. — **inspected only** — API.md *Purchase orders*; OpenAPI `GET /purchase-orders/{poId}`.
- `POST /purchase-orders/{poId}/submit` moves `draft` → `submitted` only (`workflow_gate`). — **inspected only** — API.md *Purchase orders*; OpenAPI `POST /purchase-orders/{poId}/submit`.
- `POST /purchase-orders/{poId}/receive` records delivery on a submitted PO; cumulative received quantity per line cannot exceed ordered (`receive_quantity_limit`); PO closes when every line is fully received. — **inspected only** — API.md *Purchase orders*, *Business rules* (#2); OpenAPI `POST /purchase-orders/{poId}/receive`.
- Receive payload shape is `{ "items": [{ "sku", "quantity" }] }`. — **inspected only** — API.md *Purchase orders*; OpenAPI schema `ReceiveRequest`.
- `POST /invoices` creates an invoice against a PO (`201`); initial `status` is `received`, `matched` is `false`, `partial_receipt` is `null`. — **inspected only** — API.md *Invoices*; OpenAPI schema `Invoice`, `POST /invoices`.
- Invoicing requires a submitted or closed PO (`workflow_gate`); invoice lines must match PO SKUs once (`invoice_line_validation`); invoiced amounts cannot exceed received (`overpayment_protection`); duplicate invoice numbers per vendor are rejected with case/space normalization (`duplicate_invoice_detection`). — **inspected only** — API.md *Business rules*, *Invoices*; OpenAPI `POST /invoices.description`.
- `GET /invoices/{invoiceId}` returns the invoice; unknown invoice `404`. — **inspected only** — API.md *Invoices*; OpenAPI `GET /invoices/{invoiceId}`.
- `POST /invoices/{invoiceId}/match` runs the 3-way match and sets `partial_receipt` when any PO line is not fully received (`partial_receipt_flag`); an approved invoice cannot be matched again (`workflow_gate`). — **inspected only** — API.md *Invoices*, *Business rules* (#5, #10); OpenAPI `POST /invoices/{invoiceId}/match`.
- `POST /invoices/{invoiceId}/approve` requires a prior match (`three_way_match_gate`), allows only one approval (`duplicate_approval`), posts a balanced ledger entry (`gl_balance`), and returns updated vendor exposure. — **inspected only** — API.md *Invoices*, *Business rules* (#4, #7, #9, #11); OpenAPI `POST /invoices/{invoiceId}/approve`, schema `ApproveResult`.
- Approval debits `5000 Materials Expense` and credits `2000 Accounts Payable`. — **inspected only** — API.md *Invoices* approve example; OpenAPI `POST /invoices/{invoiceId}/approve.description`.
- Match success includes `ordered_value`, `received_value`, `invoice_total`, and a `message` (e.g. match passed). — **inspected only** — API.md *Invoices* match example; OpenAPI schema `MatchResult`.
- Seed vendor `vnd-002` is inactive; creating a PO for an inactive vendor is rejected. — **inspected only** — API.md *Seed data*, *Business rules* (#1); OpenAPI `Error` example / `inactive_vendor_gate`.

---

## 2. In one document only

- Change listen port with `PORT=8001 npm start`. — **inspected only** — **API.md only** (*Basics*).
- Browse the machine-readable spec at `/openapi.json` and Swagger UI at `/docs`. — **inspected only** — **API.md only** (introduction).
- Explicit seed tables: two vendors (`vnd-001` active, `vnd-002` inactive) and five SKUs with catalog descriptions and prices. — **inspected only** — **API.md only** (*Seed data*).
- Narrative eight-step purchase-to-pay flow and “status changes only move forward.” — **inspected only** — **API.md only** (*The purchase-to-pay flow*).
- Plain-language table of all eleven business rules and what each promises. — **inspected only** — **API.md only** (*Business rules*).
- Overpayment rule explicitly states there is no tolerance. — **inspected only** — **API.md only** (*Business rules*, rule #3).
- Receive: every SKU in the delivery must appear on the PO. — **inspected only** — **API.md only** (*Purchase orders*, receive).
- PO, delivery, and invoice lines share the same quantity and unit-price limits (cross-reference in prose). — **inspected only** — **API.md only** (*Purchase orders*).
- Require `Content-Type: application/json` on every request body. — **inspected only** — **API.md only** (*Basics*).
- `404` covers both missing records and non-existent routes. — **inspected only** — **API.md only** (*Errors*).
- Ordered `curl` walkthrough and `npm run smoke` for the happy path. — **inspected only** — **API.md only** (*A full session with curl*).
- Server-assigned ID prefixes `vnd-…`, `po-…`, `inv-…` (seed vendor IDs fixed). — **inspected only** — **API.md only** (*Basics*).
- OpenAPI document version `3.1.0`; API title `P2P Practice API`, version `1.0.0`. — **inspected only** — **OpenAPI only** (`openapi`, `info`).
- Operations grouped by tags: System, Vendors, Catalog, Purchase orders, Invoices. — **inspected only** — **OpenAPI only** (operation `tags`).
- Path parameter names `vendorId`, `poId`, `invoiceId`. — **inspected only** — **OpenAPI only** (path `parameters`).
- Full component schemas (`Vendor`, `PurchaseOrder`, `Invoice`, `MatchResult`, `ApproveResult`, etc.) with types, required fields, and examples. — **inspected only** — **OpenAPI only** (`components.schemas`).
- Invoice responses include `vendor_id` and `total_amount` as first-class fields. — **inspected only** — **OpenAPI only** (schema `Invoice`).
- `minLength`, `minItems`, and `exclusiveMinimum` constraints on create/receive payloads. — **inspected only** — **OpenAPI only** (e.g. `VendorCreate`, `PoLineCreate`, `ReceiveRequest`, `InvoiceCreate`).
- `partial_receipt` on invoices is documented as `null` until match. — **inspected only** — **OpenAPI only** (schema `Invoice.properties.partial_receipt.description`).
- Match response schema restricts `status` to `matched` and `matched` to `true`; approve response restricts `status` to `approved`. — **inspected only** — **OpenAPI only** (schemas `MatchResult`, `ApproveResult`).
- Per-endpoint response descriptions (e.g. vendor/PO/invoice “not found” wording). — **inspected only** — **OpenAPI only** (path `responses`).

---

## 3. Conflicts

None found. — **inspected only**

---

## 4. Not documented

Neither source clearly answers the following. Each is a question a tester would ask the developer, marked **assumed until answered**.

- Are line `quantity` values required to be whole numbers, or are decimal quantities (e.g. `10.5`) allowed and rounded? — **assumed until answered** — **inspected only**
- What are the maximum lengths for vendor `name`, SKU strings, `description`, and `invoice_number`? — **assumed until answered** — **inspected only**
- If the client omits `Content-Type: application/json` on a POST body, is the request rejected—and with which status and `rule`? — **assumed until answered** — **inspected only**
- What happens on a second identical `POST /purchase-orders` (same vendor and lines): a new PO every time, or idempotent behavior? — **assumed until answered** — **inspected only**
- What happens if `POST /purchase-orders/{poId}/submit` is called twice on the same PO? — **assumed until answered** — **inspected only**
- What happens if `POST /purchase-orders/{poId}/receive` repeats the same delivery (same SKUs and quantities)? — **assumed until answered** — **inspected only**
- If receive includes a SKU not on the PO, which HTTP status and `rule` apply? — **assumed until answered** — **inspected only**
- Can `POST /purchase-orders` or `POST /invoices` accept an empty `line_items` / `items` array if the schema minimum is bypassed or omitted? — **assumed until answered** — **inspected only**
- Is there a maximum number of lines per PO or invoice? — **assumed until answered** — **inspected only**
- When the 3-way match fails (e.g. invoice total ≠ received value, or line price mismatch), what status, `rule`, and response body are returned? — **assumed until answered** — **inspected only**
- Must invoice line `unit_price` exactly equal the PO line `unit_price`, or only quantities and totals matter at match time? — **assumed until answered** — **inspected only**
- Can multiple invoices be recorded against one PO (partial invoicing), and how does that interact with `overpayment_protection`? — **assumed until answered** — **inspected only**
- What happens on a second `POST /invoices/{invoiceId}/match` or second `POST /invoices/{invoiceId}/approve` after success? — **assumed until answered** — **inspected only**
- Are list endpoints (`GET /vendors`, `GET /skus`) ordered deterministically? — **assumed until answered** — **inspected only**
- Is there any way to list all POs or all invoices, or only get-by-id? — **assumed until answered** — **inspected only**
- How are fractional cents handled when multiplying `quantity × unit_price` (banker’s rounding, truncate, etc.)? — **assumed until answered** — **inspected only**
- For duplicate invoice detection, how are Unicode case variants or internal whitespace treated beyond trim and ASCII case fold? — **assumed until answered** — **inspected only**
- What happens to in-flight data if the process exits without calling `POST /admin/reset` (only “restart clears” is stated)? — **assumed until answered** — **inspected only**
- Can workflow steps be skipped in practice (e.g. approve without receive, or invoice while PO is still `draft`) beyond the stated gates—what exact errors appear? — **assumed until answered** — **inspected only**
