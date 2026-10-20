# The QA agent challenge

A 60-minute exercise in the style of a live technical interview for AI-assisted QA roles. You build, live, an AI agent that tests this API by itself and reports what it found.

## The situation

A developer on your team has just finished a purchase-to-pay (P2P) API for a building-supplies business. It manages vendors, purchase orders, deliveries, vendor invoices, invoice matching and ledger postings. It runs, and it has no tests at all.

You are not asked to write a test suite. You are asked to build a **QA agent**: something that can explore the API on its own, try the cases that would cost the business money, and hand back a report a person can trust.

Use any AI tool you like. In this course we use Cursor subagents and skills, and nothing else.

## What you get

The API runs at `http://localhost:8000`. Two documents describe it:

- `docs/API.md`, the written reference with the business rules;
- `/docs` (Swagger UI) and `/openapi.json`, the generated OpenAPI document.

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/vendors` | List vendors |
| `POST` | `/vendors` | Create a vendor |
| `GET` | `/skus` | List the SKU catalog |
| `POST` | `/purchase-orders` | Create a draft purchase order |
| `POST` | `/purchase-orders/{poId}/submit` | Submit it |
| `POST` | `/purchase-orders/{poId}/receive` | Record goods received (partial deliveries allowed) |
| `GET` | `/purchase-orders/{poId}` | Purchase order with receipt status |
| `POST` | `/invoices` | Record a vendor invoice against a purchase order |
| `GET` | `/invoices/{invoiceId}` | Invoice with its status |
| `POST` | `/invoices/{invoiceId}/match` | 3-way match: order, receipt and invoice |
| `POST` | `/invoices/{invoiceId}/approve` | Approve and post to the ledger |
| `GET` | `/vendors/{vendorId}/exposure` | How much the business owes the vendor |
| `POST` | `/admin/reset` | Back to the seed data |

## The money rules

An auditor would check these first. Your agent should prove each one holds, or show exactly how it breaks. The full list of 11 rules is in `docs/API.md`.

1. **Overpayment protection.** An invoice never exceeds the value of the goods actually received.
2. **3-way match gate.** No invoice is approved before it passes the match.
3. **Partial receipt flag.** When goods are only partly received, the match says so instead of passing quietly.
4. **Inactive vendor gate.** No new purchase orders for an inactive vendor.
5. **Ledger balance.** Every approval posts an entry where debits equal credits.
6. **Duplicate invoice detection.** A vendor cannot send the same invoice number twice.

## What to build in 60 minutes

### 1. An explorer

Given only the base URL and the docs, it:

- finds out which vendors and SKUs exist;
- runs the whole flow by itself: vendor, purchase order, submit, receive, invoice, match, approve, exposure;
- logs every step with the request, the response, and its own judgement of whether the result was right and why.

### 2. An adversary

A second agent that tries to break the money rules on purpose. At a minimum it:

- approves an invoice that was never matched;
- receives more than was ordered;
- invoices more than the received value;
- orders from an inactive vendor.

For every attempt it records whether the rule **held** (the API refused, with the right rule) or was **breached** (the API accepted something it should not have).

### 3. A judge

When both agents finish, the judge reads their logs and writes one JSON report:

```json
{
  "happy_path": { "status": "PASS", "steps": [] },
  "adversarial": [
    {
      "rule": "overpayment_protection",
      "status": "HELD",
      "evidence": { "request": {}, "response": {}, "reason": "" }
    }
  ],
  "summary": ""
}
```

`happy_path.status` is `PASS` or `FAIL`. Each adversarial `status` is `HELD` or `BREACHED`. Evidence is the real request and response, not a description of them.

## If you finish early

- **Survive a changed API.** When a response has a field the agent did not expect, it adapts and keeps going instead of crashing.
- **Many orders at once.** Generate a batch of random purchase orders with different partial receipts and invoice amounts, run the adversary against all of them and report how often each rule broke.
- **Check the judge.** Plant a few known answers and measure how often the judge gets them right.

## What a strong solution shows

- **A plan, not a crawl.** The agents know what they are trying to prove before they send requests, and they handle surprises.
- **A feel for money.** You go after the dangerous rules first and try the small amounts: one cent over, one unit over, rounding, zero, negative values.
- **Cases nobody listed.** The adversary tries things the rules above do not mention.
- **A judge that checks the business, not only the status code.** A 201 can be a defect and a 400 can be wrong for the wrong reason.
- **AI used for reasoning.** The model explains why a response is or is not a defect; it is not just an HTTP client.
- **Something that runs.** A real report from a real run before the time is up.

## Questions to be ready for

- The API changes next month. How does your agent notice and adjust without someone rewriting it?
- When does a classic regression suite beat an agent like this one, and when does the agent win?
- You want this agent to run every night against a shared environment. What do you change first?
