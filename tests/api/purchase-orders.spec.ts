import { test, expect, type APIRequestContext } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';

const PO_ID = /^po-[0-9a-f]{8}$/;

const PO_C_01_BODY = {
  vendor_id: 'vnd-001',
  line_items: [
    { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', quantity: 10, unit_price: 4.75 },
    { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
  ],
};

const ONE_LINE_LUM = {
  vendor_id: 'vnd-001',
  line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
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

test('PO-C-01 POST /purchase-orders creates draft PO from API example', { tag: '@api' }, async ({
  request,
}) => {
  const response = await request.post('/purchase-orders', { data: PO_C_01_BODY });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.id).toMatch(PO_ID);
  expect(body.vendor_id).toBe('vnd-001');
  expect(body.status).toBe('draft');
  expect(body.ordered_value).toBe(95.1);
  expect(body.received_value).toBe(0);
  expect(body.fully_received).toBe(false);
  expect(body.line_items).toEqual([
    {
      sku: 'LUM-2X4-8',
      description: '2x4 stud, 8 ft',
      quantity: 10,
      unit_price: 4.75,
      received_quantity: 0,
    },
    {
      sku: 'CEM-30KG',
      description: '',
      quantity: 4,
      unit_price: 11.9,
      received_quantity: 0,
    },
  ]);
});

test('PO-C-02 POST /purchase-orders defaults omitted line description to empty', { tag: '@api' }, async ({
  request,
}) => {
  const response = await request.post('/purchase-orders', { data: ONE_LINE_LUM });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.line_items[0].description).toBe('');
  expect(body.ordered_value).toBe(4.75);
});

test('PO-C-03 POST /purchase-orders accepts minimum quantity 1', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', { data: ONE_LINE_LUM });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.line_items[0].quantity).toBe(1);
});

test('PO-C-04 POST /purchase-orders accepts maximum quantity 10000', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-001',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10000, unit_price: 4.75 }],
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.line_items[0].quantity).toBe(10000);
});

test('PO-C-05 POST /purchase-orders accepts minimum unit_price 0', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-001',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 0 }],
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.line_items[0].unit_price).toBe(0);
  expect(body.ordered_value).toBe(0);
});

test('PO-C-06 POST /purchase-orders accepts maximum unit_price 100000', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-001',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 100000 }],
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectPurchaseOrder(request, body);
  expect(body.line_items[0].unit_price).toBe(100000);
  expect(body.ordered_value).toBe(100000);
});

test('PO-C-N01 POST /purchase-orders rejects empty body object', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', { data: {} });
  await expectError(request, response, 400, 'validation_error');
  const body = await response.json();
  expect(body.detail.toLowerCase()).toMatch(/vendor_id|line_items/);
});

test('PO-C-N02 POST /purchase-orders rejects empty vendor_id', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: { vendor_id: '', line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 1 }] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('PO-C-N03 POST /purchase-orders rejects missing line_items', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', { data: { vendor_id: 'vnd-001' } });
  await expectError(request, response, 400, 'validation_error');
});

test('PO-C-N04 POST /purchase-orders rejects empty line_items array', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: { vendor_id: 'vnd-001', line_items: [] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('PO-C-N05 POST /purchase-orders rejects line missing sku', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: { vendor_id: 'vnd-001', line_items: [{ quantity: 1, unit_price: 1 }] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('PO-C-N06 POST /purchase-orders rejects whitespace-only sku', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: { vendor_id: 'vnd-001', line_items: [{ sku: '   ', quantity: 1, unit_price: 1 }] },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('PO-C-N07 POST /purchase-orders rejects quantity zero', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-001',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 0, unit_price: 4.75 }],
    },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('PO-C-N08 POST /purchase-orders rejects quantity over 10000', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-001',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 10001, unit_price: 4.75 }],
    },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('PO-C-N09 POST /purchase-orders rejects negative quantity', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-001',
      line_items: [{ sku: 'LUM-2X4-8', quantity: -1, unit_price: 4.75 }],
    },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('PO-C-N10 POST /purchase-orders rejects negative unit_price', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-001',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: -0.01 }],
    },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('PO-C-N11 POST /purchase-orders rejects unit_price over 100000', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-001',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 100001 }],
    },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('PO-C-N12 POST /purchase-orders rejects duplicate sku on one PO', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-001',
      line_items: [
        { sku: 'LUM-2X4-8', quantity: 1, unit_price: 1 },
        { sku: 'LUM-2X4-8', quantity: 2, unit_price: 2 },
      ],
    },
  });
  await expectError(request, response, 400, 'validation_error');
  const body = await response.json();
  expect(body.detail).toMatch(/sku/i);
});

test('PO-C-N13 POST /purchase-orders rejects string quantity', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-001',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 'ten', unit_price: 4.75 }],
    },
  });
  await expectError(request, response, 400, 'validation_error');
});

test('PO-C-N14 POST /purchase-orders rejects malformed JSON body', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    headers: { 'Content-Type': 'application/json' },
    data: '{not json',
  });
  await expectError(request, response, 400, 'validation_error');
  const body = await response.json();
  expect(body.detail.toLowerCase()).toMatch(/json/);
});

test('PO-C-E01 POST /purchase-orders returns 404 for unknown vendor', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-nope',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  await expectError(request, response, 404);
});

test('PO-C-B01 POST /purchase-orders rejects inactive vendor with inactive_vendor_gate', { tag: '@api' }, async ({
  request,
}) => {
  const response = await request.post('/purchase-orders', {
    data: {
      vendor_id: 'vnd-002',
      line_items: [{ sku: 'LUM-2X4-8', quantity: 1, unit_price: 4.75 }],
    },
  });
  await expectError(request, response, 400, 'inactive_vendor_gate');
});

test('PO-G-01 GET /purchase-orders returns same draft PO as create', { tag: '@api' }, async ({ request }) => {
  const create = await request.post('/purchase-orders', { data: PO_C_01_BODY });
  expect(create.status()).toBe(201);
  const created = await create.json();
  await expectPurchaseOrder(request, created);

  const get = await request.get(`/purchase-orders/${created.id}`);
  expect(get.status()).toBe(200);
  const fetched = await get.json();
  await expectPurchaseOrder(request, fetched);
  expect(fetched).toEqual(created);
});

test('PO-G-02 GET /purchase-orders shows submitted status after submit', { tag: '@api' }, async ({ request }) => {
  const create = await request.post('/purchase-orders', { data: PO_C_01_BODY });
  const created = await create.json();
  const submit = await request.post(`/purchase-orders/${created.id}/submit`);
  expect(submit.status()).toBe(200);

  const get = await request.get(`/purchase-orders/${created.id}`);
  expect(get.status()).toBe(200);
  const fetched = await get.json();
  await expectPurchaseOrder(request, fetched);
  expect(fetched.status).toBe('submitted');
  expect(fetched.ordered_value).toBe(created.ordered_value);
  expect(fetched.line_items).toEqual(created.line_items);
});

test('PO-G-E01 GET /purchase-orders returns 404 for unknown poId', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/purchase-orders/po-nope');
  await expectError(request, response, 404);
});

test('PO-S-01 POST submit moves draft purchase order to submitted', { tag: '@api' }, async ({ request }) => {
  const create = await request.post('/purchase-orders', { data: ONE_LINE_LUM });
  expect(create.status()).toBe(201);
  const draft = await create.json();

  const submit = await request.post(`/purchase-orders/${draft.id}/submit`);
  expect(submit.status()).toBe(200);
  const submitted = await submit.json();
  await expectPurchaseOrder(request, submitted);
  expect(submitted.status).toBe('submitted');
  expect(submitted.ordered_value).toBe(draft.ordered_value);
  expect(submitted.line_items).toEqual(draft.line_items);
});

test('PO-S-E01 POST submit returns 404 for unknown poId', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/purchase-orders/po-nope/submit');
  await expectError(request, response, 404);
});

test('PO-S-N01 POST submit twice on same PO returns workflow_gate', { tag: '@api' }, async ({ request }) => {
  const create = await request.post('/purchase-orders', { data: ONE_LINE_LUM });
  const { id } = await create.json();
  const first = await request.post(`/purchase-orders/${id}/submit`);
  expect(first.status()).toBe(200);

  const second = await request.post(`/purchase-orders/${id}/submit`);
  await expectError(request, second, 400, 'workflow_gate');
});

test('PO-S-N02 POST submit on closed PO returns workflow_gate', { tag: '@api' }, async ({ request }) => {
  const create = await request.post('/purchase-orders', { data: ONE_LINE_LUM });
  expect(create.status()).toBe(201);
  const { id } = await create.json();

  const submit = await request.post(`/purchase-orders/${id}/submit`);
  expect(submit.status()).toBe(200);

  const receive = await request.post(`/purchase-orders/${id}/receive`, {
    data: { items: [{ sku: 'LUM-2X4-8', quantity: 1 }] },
  });
  expect(receive.status()).toBe(200);
  const closed = await receive.json();
  expect(closed.status).toBe('closed');

  const resubmit = await request.post(`/purchase-orders/${id}/submit`);
  await expectError(request, resubmit, 400, 'workflow_gate');
});
