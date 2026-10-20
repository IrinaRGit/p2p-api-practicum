# P2P Practice API reference

This is the written reference for the API. The same API is also described by the generated OpenAPI document, which you can browse at `/docs` (Swagger UI) or download at `/openapi.json`.

The two documents are written in different ways. This one explains the business: the flow, the rules and why they exist. The OpenAPI document lists every field, type and status code. Read both. When they disagree, or when neither one answers a question, write the question down.

## Basics

| Item | Value |
| --- | --- |
| Base URL | `http://localhost:8000` (change the port with `PORT=8001 npm start`) |
| Format | JSON in, JSON out. Send `Content-Type: application/json` with every body. |
| Authentication | None. This is a local practice API. |
| Data | Kept in memory. A restart or `POST /admin/reset` returns everything to the seed data. |
| Money | Dollars, rounded to cents (two decimals). |
| IDs | Created by the server: `vnd-…`, `po-…`, `inv-…`. Seed vendors use fixed IDs. |

## Errors

Every rejected request returns a JSON body with a human-readable `detail`. When a business rule or the input validation rejects the request, the body also names the rule.

```json
{
  "detail": "Vendor vnd-002 is inactive. Purchase orders need an active vendor.",
  "rule": "inactive_vendor_gate"
}
```

| Status | Meaning | `rule` |
| --- | --- | --- |
| 200 | The action worked. | — |
| 201 | A new record was created (vendor, purchase order, invoice). | — |
| 400 | The body is invalid, or a business rule said no. | `validation_error` or one of the 11 rule names below |
| 404 | The record or the route does not exist. | not present |

## The purchase-to-pay flow

A business buys materials from a vendor and pays only for what it ordered and actually received. The API follows that story step by step.

1. Pick an active vendor (`GET /vendors`).
2. Create a purchase order (PO) for that vendor. It starts as `draft`.
3. Submit the PO. It becomes `submitted`.
4. Record goods as they arrive. Deliveries can be partial. When every line is fully received, the PO becomes `closed`.
5. Record the vendor's invoice against the PO. It starts as `received`.
6. Run the 3-way match: the PO, the goods received and the invoice are compared. The invoice becomes `matched`.
7. Approve the invoice. It becomes `approved`, and a ledger entry is posted.
8. Check the vendor exposure: how much the business now owes that vendor.

Status changes only move forward:

| Record | Statuses |
| --- | --- |
| Purchase order | `draft` → `submitted` → `closed` |
| Invoice | `received` → `matched` → `approved` |

## Seed data

After a start or a reset, the API has two vendors and five SKUs.

| Vendor ID | Name | Active |
| --- | --- | --- |
| `vnd-001` | Maple Ridge Supply | yes |
| `vnd-002` | Old Quarry Materials | no |

| SKU | Description | Catalog price |
| --- | --- | --- |
| `LUM-2X4-8` | 2x4 stud, 8 ft | 4.75 |
| `PLY-12-4X8` | Plywood sheet, 1/2 in, 4x8 ft | 22.40 |
| `CEM-30KG` | Cement bag, 30 kg | 11.90 |
| `REB-10MM-6` | Rebar, 10 mm, 6 m | 18.25 |
| `SCR-DECK-1LB` | Deck screws, 1 lb box | 9.99 |

The catalog is for reference. A purchase order carries its own `unit_price` for each line.

## Business rules

These are the rules the API promises to keep. The rule name is what you see in the `rule` field when a request is rejected.

| # | Rule | The API promises that… |
| --- | --- | --- |
| 1 | `inactive_vendor_gate` | No purchase order can be created for an inactive vendor. |
| 2 | `receive_quantity_limit` | The received quantity of a line never exceeds its ordered quantity, across all deliveries. |
| 3 | `overpayment_protection` | Everything invoiced on a PO never exceeds what was received: not per line quantity, and not in total value. There is no tolerance. |
| 4 | `three_way_match_gate` | An invoice cannot be approved until it passed the 3-way match. |
| 5 | `partial_receipt_flag` | The match result sets `partial_receipt` to `true` when any line of the PO is not fully received. |
| 6 | `duplicate_invoice_detection` | A vendor cannot submit the same invoice number twice. Numbers are compared ignoring upper or lower case and surrounding spaces, so `INV-7`, `inv-7` and ` INV-7 ` are the same number. |
| 7 | `gl_balance` | Every approval posts a balanced ledger entry: total debits equal total credits. |
| 8 | `invoice_line_validation` | Every invoice line is for a SKU on the PO, and each SKU appears once. |
| 9 | `duplicate_approval` | An invoice can be approved only once. |
| 10 | `workflow_gate` | Steps happen in order: submit only a draft, receive only on a submitted PO, invoice only a submitted or closed PO, and never match an approved invoice again. |
| 11 | `vendor_exposure_math` | A vendor's exposure equals the sum of `total_amount` over that vendor's approved invoices. |

## Endpoints

### System

`GET /health` returns `{"status": "ok"}` when the API is running.

`POST /admin/reset` deletes all purchase orders, invoices and created vendors, restores the seed data and returns `{"status": "reset"}`. Use it before every test run so tests do not depend on each other.

### Vendors

`GET /vendors` lists all vendors.

`POST /vendors` creates a vendor. `name` is required and cannot be empty. `active` is optional and defaults to `true`. Returns 201.

```json
{ "name": "Cedar Point Hardware" }
```

`GET /vendors/{vendorId}/exposure` returns what the business owes that vendor. It returns 404 for an unknown vendor.

```json
{
  "vendor_id": "vnd-001",
  "open_ap_liability": 95.1,
  "approved_invoices": ["inv-1ad78dbb"]
}
```

### Catalog

`GET /skus` lists the five SKUs with their catalog prices.

### Purchase orders

`POST /purchase-orders` creates a draft PO. Returns 201. The vendor must exist (404) and be active (rule 1). Every line needs a `sku`, a `quantity` greater than 0 and at most 10,000, and a `unit_price` from 0 to 100,000; `description` is optional. Each SKU may appear once per PO. The same quantity and price limits apply to deliveries and invoice lines.

```json
{
  "vendor_id": "vnd-001",
  "line_items": [
    { "sku": "LUM-2X4-8", "description": "2x4 stud, 8 ft", "quantity": 10, "unit_price": 4.75 },
    { "sku": "CEM-30KG", "quantity": 4, "unit_price": 11.9 }
  ]
}
```

The response shows each line with its `received_quantity`, plus `ordered_value`, `received_value` and `fully_received`.

```json
{
  "id": "po-0014ec8e",
  "vendor_id": "vnd-001",
  "status": "draft",
  "line_items": [
    { "sku": "LUM-2X4-8", "description": "2x4 stud, 8 ft", "quantity": 10, "unit_price": 4.75, "received_quantity": 0 },
    { "sku": "CEM-30KG", "description": "", "quantity": 4, "unit_price": 11.9, "received_quantity": 0 }
  ],
  "ordered_value": 95.1,
  "received_value": 0,
  "fully_received": false
}
```

`GET /purchase-orders/{poId}` returns the PO in the same shape.

`POST /purchase-orders/{poId}/submit` moves a draft to `submitted`. Anything else is rejected (rule 10).

`POST /purchase-orders/{poId}/receive` records a delivery on a submitted PO. Every SKU must be on the PO. The PO closes when every line is fully received.

```json
{ "items": [{ "sku": "LUM-2X4-8", "quantity": 10 }] }
```

### Invoices

`POST /invoices` records a vendor invoice against a PO. Returns 201 with `status: "received"`, `matched: false` and `partial_receipt: null`. Rules 3, 6, 8 and 10 apply.

```json
{
  "po_id": "po-0014ec8e",
  "invoice_number": "INV-1001",
  "line_items": [
    { "sku": "LUM-2X4-8", "quantity": 10, "unit_price": 4.75 },
    { "sku": "CEM-30KG", "quantity": 4, "unit_price": 11.9 }
  ]
}
```

`GET /invoices/{invoiceId}` returns the invoice with its current status.

`POST /invoices/{invoiceId}/match` runs the 3-way match and sets the partial-receipt flag (rule 5).

```json
{
  "invoice_id": "inv-1ad78dbb",
  "po_id": "po-0014ec8e",
  "status": "matched",
  "matched": true,
  "partial_receipt": false,
  "ordered_value": 95.1,
  "received_value": 95.1,
  "invoice_total": 95.1,
  "message": "3-way match passed."
}
```

`POST /invoices/{invoiceId}/approve` approves a matched invoice (rules 4 and 9) and posts the ledger entry (rule 7). The response includes the vendor's new exposure (rule 11).

```json
{
  "invoice_id": "inv-1ad78dbb",
  "status": "approved",
  "gl_entry": {
    "debits": [{ "account": "5000 Materials Expense", "amount": 95.1 }],
    "credits": [{ "account": "2000 Accounts Payable", "amount": 95.1 }],
    "balanced": true
  },
  "vendor_exposure": 95.1
}
```

## A full session with curl

Run these in order. Replace the IDs with the ones your responses return.

```bash
curl -s -X POST localhost:8000/admin/reset
curl -s -X POST localhost:8000/purchase-orders -H 'content-type: application/json' \
  -d '{"vendor_id":"vnd-001","line_items":[{"sku":"LUM-2X4-8","quantity":10,"unit_price":4.75}]}'
curl -s -X POST localhost:8000/purchase-orders/<PO_ID>/submit
curl -s -X POST localhost:8000/purchase-orders/<PO_ID>/receive -H 'content-type: application/json' \
  -d '{"items":[{"sku":"LUM-2X4-8","quantity":10}]}'
curl -s -X POST localhost:8000/invoices -H 'content-type: application/json' \
  -d '{"po_id":"<PO_ID>","invoice_number":"INV-1001","line_items":[{"sku":"LUM-2X4-8","quantity":10,"unit_price":4.75}]}'
curl -s -X POST localhost:8000/invoices/<INVOICE_ID>/match
curl -s -X POST localhost:8000/invoices/<INVOICE_ID>/approve
curl -s localhost:8000/vendors/vnd-001/exposure
```

Or run the same happy path in one command: `npm run smoke`.
