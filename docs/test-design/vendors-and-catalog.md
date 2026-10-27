# Test design: vendors and catalog

Endpoints: `GET /vendors`, `POST /vendors`, `GET /skus`.

Sources: `docs/API.md` (*Vendors*, *Catalog*, *Seed data*, *Errors*, *Basics*); OpenAPI `GET /vendors`, `POST /vendors`, `GET /skus` (schemas `Vendor`, `VendorCreate`, `Sku`).

**Approval:** Reply **approved** or request changes. No test code until approved.

---

## GET /vendors

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| V-L-01 | positive | `GET /vendors` after suite reset (seed state) | 200 | JSON array of `Vendor`; length 2; includes `vnd-001` / Maple Ridge Supply / `active: true` and `vnd-002` / Old Quarry Materials / `active: false` | API.md *Seed data*, *Vendors*; OpenAPI `Vendor` | — |
| V-L-02 | positive | `GET /vendors` immediately after `POST /vendors` with `{ "name": "Exposure Co <unique>" }` | 200 | Array length 3; one element matches created vendor `id` (`vnd-…`), `name`, `active: true` | API.md *Vendors* (create + list); OpenAPI `Vendor` | state |
| V-L-03 | positive | `GET /vendors` after two creates with the same `name` string | 200 | Both new vendors appear (distinct `id` values); duplicate names allowed | OpenAPI `POST /vendors` (no uniqueness rule) | state |
| V-L-04 | assumed — ask | `GET /vendors` twice after reset; compare array order | — | Are list results ordered deterministically (e.g. by id or insertion order)? | QUESTIONS.md §4 (list ordering) | — |
| V-L-E01 | error | `GET /vendors/extra` (no matching route) | 404 | `detail` present; **no** `rule` field | API.md *Errors* (404); OpenAPI N/A | — |

---

## POST /vendors

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| V-C-01 | positive | `POST /vendors` `{ "name": "Cedar Point Hardware" }` with `Content-Type: application/json` | 201 | `Vendor`: `id` matches `vnd-` prefix pattern; `name` Cedar Point Hardware; `active: true` | API.md *Vendors* example; OpenAPI `VendorCreate`, `Vendor` | — |
| V-C-02 | positive | `{ "name": "Inactive Supplier", "active": false }` | 201 | `active: false`; `name` as sent | API.md *Vendors* (`active` optional); OpenAPI `VendorCreate` | — |
| V-C-03 | positive | `{ "name": "Active Supplier", "active": true }` | 201 | `active: true` | API.md *Vendors*; OpenAPI `VendorCreate` | — |
| V-C-04 | positive | `{ "name": "  Trimmed Name  " }` | 201 | `name` is `Trimmed Name` (leading/trailing spaces removed) | OpenAPI `VendorCreate` (`name` trimmed, `minLength` 1) | boundary values |
| V-C-N01 | negative | `{}` (empty object) | 400 | `rule: validation_error`; `detail` mentions missing/invalid `name` | OpenAPI `VendorCreate` required `name` | equivalence class (missing field) |
| V-C-N02 | negative | `{ "name": "" }` | 400 | `rule: validation_error`; `detail` indicates name must not be empty | API.md *Vendors* (name cannot be empty); OpenAPI `VendorCreate` | equivalence class (empty string) |
| V-C-N03 | negative | `{ "name": "   " }` (whitespace only) | 400 | `rule: validation_error`; name empty after trim | OpenAPI `VendorCreate` trim + `min(1)` | boundary values (smallest invalid after trim) |
| V-C-N04 | negative | `{ "name": 123 }` | 400 | `rule: validation_error`; wrong type for `name` | OpenAPI `VendorCreate.name` type string | equivalence class (wrong type) |
| V-C-N05 | negative | `{ "name": "OK", "active": "yes" }` | 400 | `rule: validation_error`; wrong type for `active` | OpenAPI `VendorCreate.active` boolean | equivalence class (wrong type) |
| V-C-N06 | negative | Malformed JSON body (not parseable) | 400 | `rule: validation_error`; `detail` indicates invalid JSON | Express JSON parser + API error shape | equivalence class (malformed body) |
| V-C-A01 | assumed — ask | `POST /vendors` with valid JSON but **no** `Content-Type: application/json` | — | Rejected or accepted? Status and `rule` if rejected? | QUESTIONS.md §4 (Content-Type) | — |
| V-C-A02 | assumed — ask | `{ "name": "<very long string>" }` beyond any undocumented max length | — | Is there a max length for vendor `name`? | QUESTIONS.md §4 (max lengths) | — |

**Business rules:** None of the eleven named rules in API.md apply directly to `POST /vendors` (creating an inactive vendor is allowed; `inactive_vendor_gate` applies when creating a PO).

---

## GET /skus

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| S-L-01 | positive | `GET /skus` after suite reset | 200 | JSON array length 5; each item has `sku`, `description`, `unit_price` (number); includes all seed SKUs: `LUM-2X4-8` / 4.75, `PLY-12-4X8` / 22.4, `CEM-30KG` / 11.9, `REB-10MM-6` / 18.25, `SCR-DECK-1LB` / 9.99 with descriptions from API.md *Seed data* | API.md *Catalog*, *Seed data*; OpenAPI `Sku` | — |
| S-L-02 | positive | `GET /skus` after `POST /vendors` and other writes (no catalog mutation API) | 200 | Same five seed SKUs as S-L-01 (catalog unchanged) | API.md *Catalog* (“lists the five SKUs”); OpenAPI `GET /skus` | state |
| S-L-03 | assumed — ask | `GET /skus` twice after reset; compare array order | — | Are SKU list results ordered deterministically? | QUESTIONS.md §4 (list ordering) | — |
| S-L-E01 | error | `GET /skus/extra` (no matching route) | 404 | `detail` present; **no** `rule` field | API.md *Errors* (404); OpenAPI N/A | — |

**Business rules:** Catalog endpoints are read-only; no rule violations apply.

---

## Cross-cutting notes for implementation

- Suite setup runs `POST /admin/reset` once (see project API testing rules); individual tests create their own vendors when needed.
- Response shapes should be checked against OpenAPI component schemas `Vendor`, `Sku`, and `Error` where applicable.
- Money fields: assert catalog `unit_price` values match seed table; two-decimal rounding rules apply elsewhere in the API but seed prices are already cent-aligned.
