import { test as setup, expect } from '@playwright/test';

setup('POST /admin/reset', async ({ request }) => {
  const response = await request.post('/admin/reset');
  expect(response.status()).toBe(200);
});
