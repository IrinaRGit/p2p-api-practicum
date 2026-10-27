import { test, expect, type APIRequestContext } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';

const PO_C_01_BODY = {
  vendor_id: 'vnd-001',
  line_items: [
    { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', quantity: 10, unit_price: 4.75 },
    { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
  ],
};

const INV_ID = /^inv-[0-9a-f]{8}$/;

const ONE_LINE = [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }] as const;

async function expectInvoice(request: APIRequestContext, body: unknown) {
  await expectSchema(request, body, 'Invoice');
}

async function expectMatchResult(request: APIRequestContext, body: unknown) {
  await expectSchema(request, body, 'MatchResult');
}

async function expectError(
  request: APIRequestContext,
  response: { status: () => number; json: () => Promise<unknown> },
  status: number,
  rule?: string,
) {
  expect(response.status()).toBe(status);
  const body = (await response.json()) as { detail?: string; rule?: string };
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  if (rule !== undefined) {
    expect(body.rule).toBe(rule);
  } else {
    expect(body).not.toHaveProperty('rule');
  }
}

async function createSubmittedPo(
  request: APIRequestContext,
  body: typeof PO_C_01_BODY | { vendor_id: string; line_items: { sku: string; quantity: number; unit_price: number }[] },
) {
  const create = await request.post('/purchase-orders', { data: body });
  expect(create.status()).toBe(201);
  const po = await create.json();
  const submit = await request.post(`/purchase-orders/${po.id}/submit`);
  expect(submit.status()).toBe(200);
  return po.id as string;
}

async function closePo(
  request: APIRequestContext,
  poId: string,
  items: { sku: string; quantity: number }[],
) {
  const receive = await request.post(`/purchase-orders/${poId}/receive`, { data: { items } });
  expect(receive.status()).toBe(200);
  return receive.json();
}

async function closedPoFromExample(request: APIRequestContext) {
  const poId = await createSubmittedPo(request, PO_C_01_BODY);
  await closePo(request, poId, [
    { sku: 'LUM-2X4-8', quantity: 10 },
    { sku: 'CEM-30KG', quantity: 4 },
  ]);
  return poId;
}

test('IN-C-01 POST /invoices creates invoice against closed PO from API example', { tag: '@api' }, async ({
  request,
}) => {
  const poId = await closedPoFromExample(request);
  const invoiceNumber = `INV-${Date.now()}`;
  const line_items = [
    { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 },
    { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
  ];
  const response = await request.post('/invoices', {
    data: { po_id: poId, invoice_number: invoiceNumber, line_items },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectInvoice(request, body);
  expect(body.id).toMatch(INV_ID);
  expect(body.po_id).toBe(poId);
  expect(body.status).toBe('received');
  expect(body.matched).toBe(false);
  expect(body.partial_receipt).toBeNull();
  expect(body.total_amount).toBe(95.1);
  expect(body.line_items).toEqual(line_items);
});

test('IN-C-02 POST /invoices allows invoicing on submitted PO with partial receipt', { tag: '@api' }, async ({
  request,
}) => {
  const poId = await createSubmittedPo(request, PO_C_01_BODY);
  await closePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 10 }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-SUB-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectInvoice(request, body);
  expect(body.status).toBe('received');
});

test('IN-C-03 POST /invoices allows partial quantity invoice', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
  await closePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 10 }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-PART-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectInvoice(request, body);
  expect(body.total_amount).toBe(23.75);
});

test('IN-C-04 POST /invoices allows second invoice for remaining quantity on same PO', { tag: '@api' }, async ({
  request,
}) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
  await closePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 10 }]);

  const first = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-A-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
    },
  });
  expect(first.status()).toBe(201);

  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-B-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(201);
  await expectInvoice(request, await response.json());
});

test('IN-C-05 POST /invoices accepts minimum quantity and unit_price', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 0 }],
  });
  await closePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 1 }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-MIN-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 0 }],
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectInvoice(request, body);
  expect(body.total_amount).toBe(0);
});

test('IN-C-06 POST /invoices accepts maximum quantity and unit_price', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10000, unit_price: 100000 }],
  });
  await closePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 10000 }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-MAX-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10000, unit_price: 100000 }],
    },
  });
  expect(response.status()).toBe(201);
  await expectInvoice(request, await response.json());
});

test('IN-C-07 POST /invoices allows same invoice_number for different vendors', { tag: '@api' }, async ({
  request,
}) => {
  const sharedNumber = `SHARED-${Date.now()}`;
  const vendor = await request.post('/vendors', { data: { name: `Other Vendor ${Date.now()}` } });
  expect(vendor.status()).toBe(201);
  const { id: otherVendorId } = await vendor.json();

  const po1 = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });
  await closePo(request, po1, [{ sku: 'LUM-2X4-8', quantity: 1 }]);

  const po2 = await createSubmittedPo(request, {
    vendor_id: otherVendorId,
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });
  await closePo(request, po2, [{ sku: 'LUM-2X4-8', quantity: 1 }]);

  const first = await request.post('/invoices', {
    data: { po_id: po1, invoice_number: sharedNumber, line_items: [...ONE_LINE] },
  });
  const second = await request.post('/invoices', {
    data: { po_id: po2, invoice_number: sharedNumber, line_items: [...ONE_LINE] },
  });
  expect(first.status()).toBe(201);
  expect(second.status()).toBe(201);
});

test('IN-C-N01 POST /invoices rejects empty body object', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/invoices', { data: {} });
  await expectError(request, response, 400, 'validation_error');
  const body = await response.json();
  expect(body.detail.toLowerCase()).toMatch(/po_id|invoice_number|line_items/);
});

test('IN-C-N02 POST /invoices rejects empty po_id', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/invoices', {
    data: { po_id: '', invoice_number: 'INV-1', line_items: [...ONE_LINE] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('IN-C-N03 POST /invoices rejects empty invoice_number', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/invoices', {
    data: { po_id: 'po-1', invoice_number: '', line_items: [...ONE_LINE] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('IN-C-N04 POST /invoices rejects missing line_items', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/invoices', {
    data: { po_id: 'po-1', invoice_number: 'INV-1' },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('IN-C-N05 POST /invoices rejects empty line_items array', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/invoices', {
    data: { po_id: 'po-1', invoice_number: 'INV-1', line_items: [] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('IN-C-N06 POST /invoices rejects line missing sku', { tag: '@api' }, async ({ request }) => {
  const poId = await closedPoFromExample(request);
  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-${Date.now()}`,
      line_items: [{ quantity: 1, unit_price: 4.75 }],
    },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('IN-C-N07 POST /invoices rejects quantity zero', { tag: '@api' }, async ({ request }) => {
  const poId = await closedPoFromExample(request);
  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 0, unit_price: 4.75 }],
    },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('IN-C-N08 POST /invoices rejects quantity over 10000', { tag: '@api' }, async ({ request }) => {
  const poId = await closedPoFromExample(request);
  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10001, unit_price: 4.75 }],
    },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('IN-C-N09 POST /invoices rejects negative unit_price', { tag: '@api' }, async ({ request }) => {
  const poId = await closedPoFromExample(request);
  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: -0.01 }],
    },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('IN-C-N10 POST /invoices rejects malformed JSON body', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/invoices', {
    headers: { 'Content-Type': 'application/json' },
    data: '{not json',
  });
  await expectError(request, response, 400, 'validation_error');
  const body = await response.json();
  expect(body.detail.toLowerCase()).toMatch(/json/);
});

test('IN-C-E01 POST /invoices returns 404 for unknown po_id', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/invoices', {
    data: { po_id: 'po-nope', invoice_number: 'INV-1', line_items: [...ONE_LINE] },
  });
  await expectError(request, response, 404);
});

test('IN-C-B01 POST /invoices on draft PO returns workflow_gate', { tag: '@api' }, async ({ request }) => {
  const create = await request.post('/purchase-orders', {
    data: { vendor_id: 'vnd-001', line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }] },
  });
  expect(create.status()).toBe(201);
  const { id: poId } = await create.json();

  const response = await request.post('/invoices', {
    data: { po_id: poId, invoice_number: `INV-${Date.now()}`, line_items: [...ONE_LINE] },
  });
  await expectError(request, response, 400, 'workflow_gate');
});

test('IN-C-B02 POST /invoices rejects duplicate invoice_number for same vendor', { tag: '@api' }, async ({
  request,
}) => {
  const invoiceNumber = `INV-1001-${Date.now()}`;
  const po1 = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });
  await closePo(request, po1, [{ sku: 'LUM-2X4-8', quantity: 1 }]);
  const po2 = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });
  await closePo(request, po2, [{ sku: 'LUM-2X4-8', quantity: 1 }]);

  const first = await request.post('/invoices', {
    data: { po_id: po1, invoice_number: invoiceNumber, line_items: [...ONE_LINE] },
  });
  expect(first.status()).toBe(201);

  const response = await request.post('/invoices', {
    data: { po_id: po2, invoice_number: invoiceNumber, line_items: [...ONE_LINE] },
  });
  await expectError(request, response, 400, 'duplicate_invoice_detection');
});

test('IN-C-B03 POST /invoices rejects case-insensitive duplicate invoice_number', { tag: '@api' }, async ({
  request,
}) => {
  const suffix = Date.now();
  const po1 = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });
  await closePo(request, po1, [{ sku: 'LUM-2X4-8', quantity: 1 }]);
  const po2 = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });
  await closePo(request, po2, [{ sku: 'LUM-2X4-8', quantity: 1 }]);

  const first = await request.post('/invoices', {
    data: { po_id: po1, invoice_number: `INV-7-${suffix}`, line_items: [...ONE_LINE] },
  });
  expect(first.status()).toBe(201);

  const response = await request.post('/invoices', {
    data: { po_id: po2, invoice_number: ` inv-7-${suffix} `, line_items: [...ONE_LINE] },
  });
  await expectError(request, response, 400, 'duplicate_invoice_detection');
});

test('IN-C-B04 POST /invoices rejects sku not on purchase order', { tag: '@api' }, async ({ request }) => {
  const poId = await closedPoFromExample(request);
  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-${Date.now()}`,
      line_items: [{ sku: 'NOT-ON-PO', quantity: 1, unit_price: 1 }],
    },
  });
  await expectError(request, response, 400, 'invoice_line_validation');
});

test('IN-C-B05 POST /invoices rejects duplicate sku on one invoice', { tag: '@api' }, async ({ request }) => {
  const poId = await closedPoFromExample(request);
  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-${Date.now()}`,
      line_items: [
        { sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 },
        { sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 },
      ],
    },
  });
  await expectError(request, response, 400, 'invoice_line_validation');
});

test('IN-C-B06 POST /invoices with no goods received returns overpayment_protection', { tag: '@api' }, async ({
  request,
}) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  await expectError(request, response, 400, 'overpayment_protection');
});

test('IN-C-B07 POST /invoices rejects invoice total above received value', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
  await closePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 10 }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 5 }],
    },
  });
  await expectError(request, response, 400, 'overpayment_protection');
});

test('IN-C-B08 POST /invoices rejects quantity over received on line', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
  await closePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 5 }]);

  const response = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 6, unit_price: 4.75 }],
    },
  });
  await expectError(request, response, 400, 'overpayment_protection');
});

test('IN-G-01 GET /invoices returns same invoice as create', { tag: '@api' }, async ({ request }) => {
  const poId = await closedPoFromExample(request);
  const create = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-GET-${Date.now()}`,
      line_items: [
        { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 },
        { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
      ],
    },
  });
  expect(create.status()).toBe(201);
  const created = await create.json();

  const get = await request.get(`/invoices/${created.id}`);
  expect(get.status()).toBe(200);
  const fetched = await get.json();
  await expectInvoice(request, fetched);
  expect(fetched).toEqual(created);
});

test('IN-G-02 GET /invoices shows matched state after match', { tag: '@api' }, async ({ request }) => {
  const poId = await closedPoFromExample(request);
  const create = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-MATCH-GET-${Date.now()}`,
      line_items: [
        { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 },
        { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
      ],
    },
  });
  const created = await create.json();
  const match = await request.post(`/invoices/${created.id}/match`);
  expect(match.status()).toBe(200);

  const get = await request.get(`/invoices/${created.id}`);
  expect(get.status()).toBe(200);
  const fetched = await get.json();
  await expectInvoice(request, fetched);
  expect(fetched.status).toBe('matched');
  expect(fetched.matched).toBe(true);
  expect(fetched.partial_receipt).toBe(false);
});

test('IN-G-E01 GET /invoices returns 404 for unknown invoiceId', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/invoices/inv-nope');
  await expectError(request, response, 404);
});

test('IN-M-01 POST match returns MatchResult for full receipt', { tag: '@api' }, async ({ request }) => {
  const poId = await closedPoFromExample(request);
  const create = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-M-${Date.now()}`,
      line_items: [
        { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 },
        { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
      ],
    },
  });
  const { id: invoiceId } = await create.json();

  const response = await request.post(`/invoices/${invoiceId}/match`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectMatchResult(request, body);
  expect(body.invoice_id).toBe(invoiceId);
  expect(body.po_id).toBe(poId);
  expect(body.status).toBe('matched');
  expect(body.matched).toBe(true);
  expect(body.partial_receipt).toBe(false);
  expect(body.ordered_value).toBe(95.1);
  expect(body.received_value).toBe(95.1);
  expect(body.invoice_total).toBe(95.1);
  expect(body.message.toLowerCase()).toMatch(/pass/);
});

test('IN-M-02 POST match sets partial_receipt when PO not fully received', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, PO_C_01_BODY);
  await closePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 5 }]);

  const create = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-PART-M-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 5, unit_price: 4.75 }],
    },
  });
  const { id: invoiceId } = await create.json();

  const response = await request.post(`/invoices/${invoiceId}/match`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectMatchResult(request, body);
  expect(body.partial_receipt).toBe(true);
  expect(body.message.toLowerCase()).toMatch(/partial/);
});

test('IN-M-E01 POST match returns 404 for unknown invoiceId', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/invoices/inv-nope/match');
  await expectError(request, response, 404);
});

test('IN-M-B01 POST match on approved invoice returns workflow_gate', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });
  await closePo(request, poId, [{ sku: 'LUM-2X4-8', quantity: 1 }]);

  const create = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-APP-${Date.now()}`,
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  const { id: invoiceId } = await create.json();
  await request.post(`/invoices/${invoiceId}/match`);
  const approve = await request.post(`/invoices/${invoiceId}/approve`);
  expect(approve.status()).toBe(200);

  const response = await request.post(`/invoices/${invoiceId}/match`);
  await expectError(request, response, 400, 'workflow_gate');
});
