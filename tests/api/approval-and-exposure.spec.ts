import { test, expect, type APIRequestContext } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';

const PO_FULL_EXAMPLE = {
  line_items: [
    { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', quantity: 10, unit_price: 4.75 },
    { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
  ],
  invoice_lines: [
    { sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 },
    { sku: 'CEM-30KG', quantity: 4, unit_price: 11.9 },
  ],
  receive: [
    { sku: 'LUM-2X4-8', quantity: 10 },
    { sku: 'CEM-30KG', quantity: 4 },
  ],
  total: 95.1,
} as const;

const EXPENSE = '5000 Materials Expense';
const PAYABLE = '2000 Accounts Payable';

async function expectApproveResult(request: APIRequestContext, body: unknown) {
  await expectSchema(request, body, 'ApproveResult');
}

async function expectVendorExposure(request: APIRequestContext, body: unknown) {
  await expectSchema(request, body, 'VendorExposure');
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

async function createVendor(request: APIRequestContext, label: string) {
  const response = await request.post('/vendors', { data: { name: `${label} ${Date.now()}` } });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return body.id as string;
}

async function createSubmittedPo(
  request: APIRequestContext,
  vendorId: string,
  line_items: { sku: string; quantity: number; unit_price: number; description?: string }[],
) {
  const create = await request.post('/purchase-orders', { data: { vendor_id: vendorId, line_items } });
  expect(create.status()).toBe(201);
  const po = await create.json();
  const submit = await request.post(`/purchase-orders/${po.id}/submit`);
  expect(submit.status()).toBe(200);
  return po.id as string;
}

async function receiveItems(
  request: APIRequestContext,
  poId: string,
  items: { sku: string; quantity: number }[],
) {
  const response = await request.post(`/purchase-orders/${poId}/receive`, { data: { items } });
  expect(response.status()).toBe(200);
}

async function createMatchedInvoice(
  request: APIRequestContext,
  vendorId: string,
  config: {
    line_items: { sku: string; quantity: number; unit_price: number; description?: string }[];
    receive: { sku: string; quantity: number }[];
    invoice_lines: { sku: string; quantity: number; unit_price: number }[];
  },
) {
  const poId = await createSubmittedPo(request, vendorId, config.line_items);
  await receiveItems(request, poId, config.receive);
  const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const create = await request.post('/invoices', {
    data: { po_id: poId, invoice_number: invoiceNumber, line_items: config.invoice_lines },
  });
  expect(create.status()).toBe(201);
  const invoice = await create.json();
  const match = await request.post(`/invoices/${invoice.id}/match`);
  expect(match.status()).toBe(200);
  return { invoiceId: invoice.id as string, vendorId, poId, total: invoice.total_amount as number };
}

async function matchedFullExample(request: APIRequestContext, vendorId = 'vnd-001') {
  return createMatchedInvoice(request, vendorId, PO_FULL_EXAMPLE);
}

async function matchedLumInvoice(request: APIRequestContext, vendorId: string) {
  return createMatchedInvoice(request, vendorId, {
    line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
    receive: [{ sku: 'LUM-2X4-8', quantity: 10 }],
    invoice_lines: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }],
  });
}

test('AE-A-01 POST approve posts balanced GL entry and vendor exposure', { tag: '@api' }, async ({ request }) => {
  const { invoiceId } = await matchedFullExample(request);

  const response = await request.post(`/invoices/${invoiceId}/approve`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectApproveResult(request, body);
  expect(body.invoice_id).toBe(invoiceId);
  expect(body.status).toBe('approved');
  expect(body.gl_entry.balanced).toBe(true);
  expect(body.gl_entry.debits).toEqual([{ account: EXPENSE, amount: 95.1 }]);
  expect(body.gl_entry.credits).toEqual([{ account: PAYABLE, amount: 95.1 }]);
  expect(body.vendor_exposure).toBe(95.1);
});

test('AE-A-02 POST approve vendor_exposure matches GET exposure', { tag: '@api' }, async ({ request }) => {
  const vendorId = await createVendor(request, 'Exposure Match Co');
  const { invoiceId } = await matchedFullExample(request, vendorId);

  const approve = await request.post(`/invoices/${invoiceId}/approve`);
  expect(approve.status()).toBe(200);
  const approved = await approve.json();

  const exposure = await request.get(`/vendors/${vendorId}/exposure`);
  expect(exposure.status()).toBe(200);
  const expBody = await exposure.json();
  await expectVendorExposure(request, expBody);
  expect(approved.vendor_exposure).toBe(expBody.open_ap_liability);
  expect(expBody.approved_invoices).toContain(invoiceId);
});

test('AE-A-03 POST approve second invoice increases vendor_exposure cumulatively', { tag: '@api' }, async ({
  request,
}) => {
  const vendorId = await createVendor(request, 'Cumulative Exposure Co');
  const first = await matchedFullExample(request, vendorId);
  const approve1 = await request.post(`/invoices/${first.invoiceId}/approve`);
  expect(approve1.status()).toBe(200);

  const second = await matchedLumInvoice(request, vendorId);
  const approve2 = await request.post(`/invoices/${second.invoiceId}/approve`);
  expect(approve2.status()).toBe(200);
  const body = await approve2.json();
  await expectApproveResult(request, body);
  expect(body.vendor_exposure).toBe(142.6);
});

test('AE-A-E01 POST approve returns 404 for unknown invoiceId', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/invoices/inv-nope/approve');
  await expectError(request, response, 404);
});

test('AE-A-B01 POST approve without match returns three_way_match_gate', { tag: '@api' }, async ({ request }) => {
  const vendorId = 'vnd-001';
  const poId = await createSubmittedPo(request, vendorId, PO_FULL_EXAMPLE.line_items);
  await receiveItems(request, poId, [...PO_FULL_EXAMPLE.receive]);
  const create = await request.post('/invoices', {
    data: {
      po_id: poId,
      invoice_number: `INV-NOMATCH-${Date.now()}`,
      line_items: [...PO_FULL_EXAMPLE.invoice_lines],
    },
  });
  expect(create.status()).toBe(201);
  const { id: invoiceId } = await create.json();

  const response = await request.post(`/invoices/${invoiceId}/approve`);
  await expectError(request, response, 400, 'three_way_match_gate');
});

test('AE-A-B02 POST approve twice returns duplicate_approval', { tag: '@api' }, async ({ request }) => {
  const { invoiceId } = await matchedLumInvoice(request, 'vnd-001');
  const first = await request.post(`/invoices/${invoiceId}/approve`);
  expect(first.status()).toBe(200);

  const second = await request.post(`/invoices/${invoiceId}/approve`);
  await expectError(request, second, 400, 'duplicate_approval');
});

test('AE-E-01 GET exposure is zero with no approved invoices for vendor', { tag: '@api' }, async ({ request }) => {
  const vendorId = await createVendor(request, 'Zero Exposure Co');

  const response = await request.get(`/vendors/${vendorId}/exposure`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectVendorExposure(request, body);
  expect(body.vendor_id).toBe(vendorId);
  expect(body.open_ap_liability).toBe(0);
  expect(body.approved_invoices).toEqual([]);
});

test('AE-E-02 GET exposure reflects one approved invoice', { tag: '@api' }, async ({ request }) => {
  const vendorId = await createVendor(request, 'One Invoice Exposure');
  const { invoiceId } = await matchedFullExample(request, vendorId);
  await request.post(`/invoices/${invoiceId}/approve`);

  const response = await request.get(`/vendors/${vendorId}/exposure`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectVendorExposure(request, body);
  expect(body.open_ap_liability).toBe(95.1);
  expect(body.approved_invoices).toHaveLength(1);
  expect(body.approved_invoices[0]).toBe(invoiceId);
});

test('AE-E-03 GET exposure sums two approved invoices', { tag: '@api' }, async ({ request }) => {
  const vendorId = await createVendor(request, 'Two Invoice Exposure');
  const first = await matchedFullExample(request, vendorId);
  await request.post(`/invoices/${first.invoiceId}/approve`);
  const second = await matchedLumInvoice(request, vendorId);
  await request.post(`/invoices/${second.invoiceId}/approve`);

  const response = await request.get(`/vendors/${vendorId}/exposure`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectVendorExposure(request, body);
  expect(body.open_ap_liability).toBe(142.6);
  expect(body.approved_invoices).toHaveLength(2);
  expect(body.approved_invoices).toEqual(expect.arrayContaining([first.invoiceId, second.invoiceId]));
});

test('AE-E-04 GET exposure excludes matched but unapproved invoice', { tag: '@api' }, async ({ request }) => {
  const vendorId = await createVendor(request, 'Matched Not Approved');
  const { invoiceId } = await matchedLumInvoice(request, vendorId);

  const response = await request.get(`/vendors/${vendorId}/exposure`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectVendorExposure(request, body);
  expect(body.open_ap_liability).toBe(0);
  expect(body.approved_invoices).not.toContain(invoiceId);
});

test('AE-E-05 GET exposure for inactive seed vendor with no approvals', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/vendors/vnd-002/exposure');
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectVendorExposure(request, body);
  expect(body.vendor_id).toBe('vnd-002');
  expect(body.open_ap_liability).toBe(0);
});

test('AE-E-06 GET exposure for other vendor unchanged when one vendor is approved', { tag: '@api' }, async ({
  request,
}) => {
  const { invoiceId } = await matchedLumInvoice(request, 'vnd-001');
  await request.post(`/invoices/${invoiceId}/approve`);

  const response = await request.get('/vendors/vnd-002/exposure');
  expect(response.status()).toBe(200);
  const body = await response.json();
  await expectVendorExposure(request, body);
  expect(body.open_ap_liability).toBe(0);
});

test('AE-E-E01 GET exposure returns 404 for unknown vendorId', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/vendors/vnd-nope/exposure');
  await expectError(request, response, 404);
});
