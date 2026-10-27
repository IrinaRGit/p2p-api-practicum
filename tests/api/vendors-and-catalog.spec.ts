import { test, expect } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';

const VND_ID = /^vnd-[0-9a-f]{8}$/;

/** Seed catalog — API.md *Seed data* */
const SEED_SKUS = [
  { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', unit_price: 4.75 },
  { sku: 'PLY-12-4X8', description: 'Plywood sheet, 1/2 in, 4x8 ft', unit_price: 22.4 },
  { sku: 'CEM-30KG', description: 'Cement bag, 30 kg', unit_price: 11.9 },
  { sku: 'REB-10MM-6', description: 'Rebar, 10 mm, 6 m', unit_price: 18.25 },
  { sku: 'SCR-DECK-1LB', description: 'Deck screws, 1 lb box', unit_price: 9.99 },
] as const;

async function expectVendorsArray(request: Parameters<typeof expectSchema>[0], body: unknown) {
  expect(Array.isArray(body)).toBe(true);
  for (const vendor of body as unknown[]) {
    await expectSchema(request, vendor, 'Vendor');
  }
}

test.describe.configure({ mode: 'serial' });

test('V-L-01 GET /vendors lists seed vendors after reset', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/vendors');
  expect(response.status()).toBe(200);
  const vendors = await response.json();
  await expectVendorsArray(request, vendors);
  expect(vendors).toEqual(
    expect.arrayContaining([
      { id: 'vnd-001', name: 'Maple Ridge Supply', active: true },
      { id: 'vnd-002', name: 'Old Quarry Materials', active: false },
    ]),
  );
});

test('V-L-02 GET /vendors includes vendor created immediately before', { tag: '@api' }, async ({
  request,
}) => {
  const unique = `Exposure Co ${Date.now()}`;
  const create = await request.post('/vendors', { data: { name: unique } });
  expect(create.status()).toBe(201);
  const created = await create.json();
  await expectSchema(request, created, 'Vendor');

  const list = await request.get('/vendors');
  expect(list.status()).toBe(200);
  const vendors = await list.json();
  await expectVendorsArray(request, vendors);
  expect(vendors).toContainEqual({
    id: created.id,
    name: unique,
    active: true,
  });
});

test('V-L-03 GET /vendors allows duplicate names with distinct ids', { tag: '@api' }, async ({
  request,
}) => {
  const sharedName = `Duplicate Name Co ${Date.now()}`;
  const first = await request.post('/vendors', { data: { name: sharedName } });
  const second = await request.post('/vendors', { data: { name: sharedName } });
  expect(first.status()).toBe(201);
  expect(second.status()).toBe(201);
  const a = await first.json();
  const b = await second.json();
  expect(a.id).not.toBe(b.id);

  const list = await request.get('/vendors');
  expect(list.status()).toBe(200);
  const vendors = await list.json();
  await expectVendorsArray(request, vendors);
  const matches = vendors.filter((v: { name: string }) => v.name === sharedName);
  expect(matches).toHaveLength(2);
  expect(new Set(matches.map((v: { id: string }) => v.id)).size).toBe(2);
});

test('V-L-E01 GET /vendors/extra returns 404 without rule', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/vendors/extra');
  expect(response.status()).toBe(404);
  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body).not.toHaveProperty('rule');
});

test('V-C-01 POST /vendors creates vendor with default active true', { tag: '@api' }, async ({
  request,
}) => {
  const response = await request.post('/vendors', { data: { name: 'Cedar Point Hardware' } });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.id).toMatch(VND_ID);
  expect(body.name).toBe('Cedar Point Hardware');
  expect(body.active).toBe(true);
});

test('V-C-02 POST /vendors creates inactive vendor when active is false', { tag: '@api' }, async ({
  request,
}) => {
  const response = await request.post('/vendors', {
    data: { name: 'Inactive Supplier', active: false },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.name).toBe('Inactive Supplier');
  expect(body.active).toBe(false);
});

test('V-C-03 POST /vendors creates active vendor when active is true', { tag: '@api' }, async ({
  request,
}) => {
  const response = await request.post('/vendors', {
    data: { name: 'Active Supplier', active: true },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.active).toBe(true);
});

test('V-C-04 POST /vendors trims surrounding whitespace from name', { tag: '@api' }, async ({
  request,
}) => {
  const response = await request.post('/vendors', { data: { name: '  Trimmed Name  ' } });
  expect(response.status()).toBe(201);
  const body = await response.json();
  await expectSchema(request, body, 'Vendor');
  expect(body.name).toBe('Trimmed Name');
});

test('V-C-N01 POST /vendors rejects empty body object', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/vendors', { data: {} });
  expect(response.status()).toBe(400);
  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
  expect(body.detail.toLowerCase()).toMatch(/name/);
});

test('V-C-N02 POST /vendors rejects empty name string', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/vendors', { data: { name: '' } });
  expect(response.status()).toBe(400);
  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
  expect(body.detail.toLowerCase()).toMatch(/name/);
});

test('V-C-N03 POST /vendors rejects whitespace-only name', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/vendors', { data: { name: '   ' } });
  expect(response.status()).toBe(400);
  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
  expect(body.detail.toLowerCase()).toMatch(/name/);
});

test('V-C-N04 POST /vendors rejects non-string name', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/vendors', { data: { name: 123 } });
  expect(response.status()).toBe(400);
  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
});

test('V-C-N05 POST /vendors rejects non-boolean active', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/vendors', { data: { name: 'OK', active: 'yes' } });
  expect(response.status()).toBe(400);
  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
});

test('V-C-N06 POST /vendors rejects malformed JSON body', { tag: '@api' }, async ({ request }) => {
  const response = await request.post('/vendors', {
    headers: { 'Content-Type': 'application/json' },
    data: '{not json',
  });
  expect(response.status()).toBe(400);
  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.rule).toBe('validation_error');
  expect(body.detail.toLowerCase()).toMatch(/json/);
});

test('S-L-01 GET /skus lists five seed catalog items', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/skus');
  expect(response.status()).toBe(200);
  const skus = await response.json();
  expect(Array.isArray(skus)).toBe(true);
  expect(skus).toHaveLength(5);
  for (const sku of skus) {
    await expectSchema(request, sku, 'Sku');
  }
  for (const expected of SEED_SKUS) {
    expect(skus).toContainEqual(expected);
  }
});

test('S-L-02 GET /skus unchanged after creating a vendor', { tag: '@api' }, async ({ request }) => {
  const create = await request.post('/vendors', { data: { name: `Catalog check ${Date.now()}` } });
  expect(create.status()).toBe(201);

  const response = await request.get('/skus');
  expect(response.status()).toBe(200);
  const skus = await response.json();
  expect(skus).toHaveLength(5);
  for (const expected of SEED_SKUS) {
    expect(skus).toContainEqual(expected);
  }
});

test('S-L-E01 GET /skus/extra returns 404 without rule', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/skus/extra');
  expect(response.status()).toBe(404);
  const body = await response.json();
  await expectSchema(request, body, 'Error');
  expect(body.detail).toBeTruthy();
  expect(body).not.toHaveProperty('rule');
});
