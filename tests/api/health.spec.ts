import { test, expect } from '@playwright/test';

test('GET /health returns 200 and status ok', { tag: '@api' }, async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: 'ok' });
});
