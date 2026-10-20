const baseUrl = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 8000}`;

async function call(method: string, path: string, body?: unknown, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  const mark = response.status === expected ? 'ok ' : 'FAIL';
  console.log(`${mark} ${method} ${path} -> ${response.status}`);
  if (response.status !== expected) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  return data;
}

await call('POST', '/admin/reset');
await call('GET', '/health');
const vendors = await call('GET', '/vendors');
const vendor = vendors.find((candidate: { active: boolean }) => candidate.active);
const po = await call(
  'POST',
  '/purchase-orders',
  { vendor_id: vendor.id, line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }] },
  201,
);
await call('POST', `/purchase-orders/${po.id}/submit`);
const received = await call('POST', `/purchase-orders/${po.id}/receive`, { items: [{ sku: 'LUM-2X4-8', quantity: 10 }] });
const invoice = await call(
  'POST',
  '/invoices',
  { po_id: po.id, invoice_number: `SMOKE-${Date.now()}`, line_items: [{ sku: 'LUM-2X4-8', quantity: 10, unit_price: 4.75 }] },
  201,
);
await call('POST', `/invoices/${invoice.id}/match`);
const approval = await call('POST', `/invoices/${invoice.id}/approve`);
const exposure = await call('GET', `/vendors/${vendor.id}/exposure`);

console.log(
  `\nHappy path passed: PO ${po.id} ${received.status}, invoice ${invoice.id} ${approval.status}, exposure ${exposure.open_ap_liability}.`,
);
