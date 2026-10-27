---
name: api-schema-validation
description: Checks that API responses match the shapes in /openapi.json, through one helper, expectSchema. Use when writing or reviewing an API test, when the user asks to validate a response, check a schema, a contract, field types or required fields, or when a response has a field nobody expected. Do NOT use to decide which cases to test — that is api-test-design.
paths: "tests/**"
---

# API schema validation

Helper: [tests/api/helpers/schema.ts](../../../tests/api/helpers/schema.ts) — `expectSchema(request, body, name)`.

## Steps

1. Find the schema name in `/openapi.json` (the response's `$ref` under paths → responses); never guess it. Rejected requests use `Error`.
2. Call `expectSchema` on every response body, success and error.
3. A schema check proves the shape, not the business: still assert the values that matter (status, rule, amounts, flags).
4. When a check fails, show the Ajv errors and ask the human whether the API or the docs are wrong. Never edit the schema or loosen the check to make it pass.

## Helper behavior

- Loads `GET /openapi.json` once per worker via Playwright `request`.
- `new Ajv({ strict: false, allErrors: true })`, then `addSchema(doc, 'openapi')` (strict off for OpenAPI-only keywords such as `example`).
- Resolves `openapi#/components/schemas/<name>`; throws if the name is missing or validation fails (Ajv paths and messages).

## Example

```ts
import { expectSchema } from './helpers/schema.js';

const res = await request.post('/vendors', { data: { name: 'Acme' } });
expect(res.status()).toBe(201);
const body = await res.json();
await expectSchema(request, body, 'Vendor');
expect(body.name).toBe('Acme');
```
