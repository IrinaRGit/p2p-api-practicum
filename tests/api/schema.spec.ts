import { test, expect } from '@playwright/test';
import { expectSchema } from './helpers/schema.js';

test('GET /vendors — every vendor matches Vendor schema', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/vendors');
  expect(response.status()).toBe(200);
  const vendors: unknown = await response.json();
  expect(Array.isArray(vendors)).toBe(true);
  for (const vendor of vendors as unknown[]) {
    await expectSchema(request, vendor, 'Vendor');
  }
});

test('expectSchema rejects a vendor body missing active', { tag: '@api' }, async ({ request }) => {
  await expect(
    expectSchema(request, { id: 'vnd-test', name: 'No Active Field' }, 'Vendor'),
  ).rejects.toThrow(/active|schema Vendor/i);
});

test('expectSchema rejects an unknown schema name', { tag: '@api' }, async ({ request }) => {
  await expect(expectSchema(request, { status: 'ok' }, 'NotARealSchema')).rejects.toThrow(
    /components\/schemas\/NotARealSchema does not exist/,
  );
});
