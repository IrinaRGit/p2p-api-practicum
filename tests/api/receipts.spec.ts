import { test, expect, type APIRequestContext } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';

const PO_C_01_BODY = {
  vendor_id: 'vnd-001',
  line_items: [
    { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', quantity: 10, unit_price: 4.75 },
    { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
  ],
};

async function expectPurchaseOrder(request: APIRequestContext, body: unknown) {
  await expectSchema(request, body, 'PurchaseOrder');
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

test('RC-P-01 POST receive fully closes single-line PO', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.line_items[0].received_quantity).toBe(10);
  expect(body.received_value).toBe(47.5);
  expect(body.fully_received).toBe(true);
  expect(body.status).toBe('closed');
});

test('RC-P-02 POST receive partial line leaves PO submitted', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, PO_C_01_BODY);

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  const lum = body.line_items.find((line: { sku: string }) => line.sku === 'LUM-2X4-8');
  const cem = body.line_items.find((line: { sku: string }) => line.sku === 'CEM-30KG');
  expect(lum.received_quantity).toBe(10);
  expect(cem.received_quantity).toBe(0);
  expect(body.fully_received).toBe(false);
  expect(body.status).toBe('submitted');
  expect(body.received_value).toBe(47.5);
});

test('RC-P-03 POST receive second partial closes multi-line PO', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, PO_C_01_BODY);

  const first = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
  });
  expect(first.status()).toBe(200);

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'CEM-30KG', quantity: 4 }] },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.fully_received).toBe(true);
  expect(body.status).toBe('closed');
  expect(body.received_value).toBe(95.1);
});

test('RC-P-04 POST receive all lines in one delivery closes PO', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, PO_C_01_BODY);

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: {
      items: [
        { sku: 'LUM-2X4-8', quantity: 10 },
        { sku: 'CEM-30KG', quantity: 4 },
      ],
    },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.status).toBe('closed');
  expect(body.fully_received).toBe(true);
});

test('RC-P-05 POST receive split deliveries closes PO when total matches ordered', { tag: '@api' }, async ({
  request,
}) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const first = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 4 }] },
  });
  expect(first.status()).toBe(200);

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 6 }] },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.line_items[0].received_quantity).toBe(10);
  expect(body.status).toBe('closed');
});

test('RC-P-06 POST receive accepts minimum quantity 1', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.line_items[0].received_quantity).toBe(1);
});

test('RC-P-07 POST receive accepts maximum quantity 10000', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10000, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 10000 }] },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.line_items[0].received_quantity).toBe(10000);
});

test('RC-P-08 POST receive aggregates duplicate sku rows in one payload', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: {
      items: [
        { sku: 'LUM-2X4-8', quantity: 3 },
        { sku: 'LUM-2X4-8', quantity: 2 },
      ],
    },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.line_items[0].received_quantity).toBe(5);
});

test('RC-N-01 POST receive rejects empty body object', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, { data: {} });
  await expectError(request, response, 400, 'validation_error');
  const body = await response.json();
  expect(body.detail.toLowerCase()).toMatch(/items/);
});

test('RC-N-02 POST receive rejects empty items array', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, { data: { items: [] } });
  await expectError(request, response, 400, 'validation_error');
});

test('RC-N-03 POST receive rejects item missing sku', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ quantity: 1 }] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('RC-N-04 POST receive rejects whitespace-only sku', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: '   ', quantity: 1 }] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('RC-N-05 POST receive rejects quantity zero', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 0 }] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('RC-N-06 POST receive rejects quantity over 10000', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 10001 }] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('RC-N-07 POST receive rejects negative quantity', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: -1 }] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('RC-N-08 POST receive rejects string quantity', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 'ten' }] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('RC-N-09 POST receive rejects malformed JSON body', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    headers: { 'Content-Type': 'application/json' },
    data: '{not json',
  });
  await expectError(request, response, 400, 'validation_error');
  const body = await response.json();
  expect(body.detail.toLowerCase()).toMatch(/json/);
});

test('RC-E-01 POST receive returns 404 for unknown poId', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders/po-nope/receive', {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
  });
  await expectError(request, response, 404);
});

test('RC-B-01 POST receive on draft PO returns workflow_gate', { tag: '@api' }, async ({ request }) => {
  const create = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-001',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  expect(create.status()).toBe(201);
  const { id: poId } = await create.json();

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
  });
  await expectError(request, response, 400, 'workflow_gate');
});

test('RC-B-02 POST receive on closed PO returns workflow_gate', { tag: '@api' }, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
  });

  const close = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
  });
  expect(close.status()).toBe(200);

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
  });
  await expectError(request, response, 400, 'workflow_gate');
});

test('RC-B-03 POST receive over ordered quantity in one delivery returns receive_quantity_limit', {
  tag: '@api',
}, async ({ request }) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 11 }] },
  });
  await expectError(request, response, 400, 'receive_quantity_limit');
});

test('RC-B-04 POST receive cumulative over ordered returns receive_quantity_limit', { tag: '@api' }, async ({
  request,
}) => {
  const poId = await createSubmittedPo(request, {
    vendor_id: 'vnd-001',
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });

  const first = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 6 }] },
  });
  expect(first.status()).toBe(200);

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 6 }] },
  });
  await expectError(request, response, 400, 'receive_quantity_limit');
});

test('RC-B-05 POST receive again on fully received line returns receive_quantity_limit', { tag: '@api' }, async ({
  request,
}) => {
  const poId = await createSubmittedPo(request, PO_C_01_BODY);

  const first = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] },
  });
  expect(first.status()).toBe(200);

  const response = await request.post(`/purchase-orders/${poId}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
  });
  await expectError(request, response, 400, 'receive_quantity_limit');
});
