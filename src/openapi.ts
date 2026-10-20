import { OpenAPIRegistry, OpenApiGeneratorV31, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  ApproveResultSchema,
  ErrorSchema,
  HealthSchema,
  InvoiceCreateSchema,
  InvoiceSchema,
  MatchResultSchema,
  PurchaseOrderCreateSchema,
  PurchaseOrderSchema,
  ReceiveRequestSchema,
  ResetSchema,
  SkuSchema,
  VendorCreateSchema,
  VendorExposureSchema,
  VendorSchema,
} from './schemas.js';

const registry = new OpenAPIRegistry();

const json = (schema: z.ZodTypeAny) => ({ content: { 'application/json': { schema } } });
const ok = (description: string, schema: z.ZodTypeAny) => ({ description, ...json(schema) });
const error = (description: string) => ({ description, ...json(ErrorSchema) });

const poId = z.object({ poId: z.string().openapi({ example: 'po-1a2b3c4d' }) });
const invoiceId = z.object({ invoiceId: z.string().openapi({ example: 'inv-5e6f7a8b' }) });
const vendorId = z.object({ vendorId: z.string().openapi({ example: 'vnd-001' }) });

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/health',
    tags: ['System'],
    summary: 'Check that the API is running',
    responses: { 200: ok('The API is up.', HealthSchema) },
  },
  {
    method: 'post',
    path: '/admin/reset',
    tags: ['System'],
    summary: 'Reset all data to the seed state',
    description: 'Deletes every purchase order, invoice and created vendor, then restores the two seed vendors and the SKU catalog.',
    responses: { 200: ok('Data was reset.', ResetSchema) },
  },
  {
    method: 'get',
    path: '/vendors',
    tags: ['Vendors'],
    summary: 'List vendors',
    responses: { 200: ok('All vendors.', z.array(VendorSchema)) },
  },
  {
    method: 'post',
    path: '/vendors',
    tags: ['Vendors'],
    summary: 'Create a vendor',
    request: { body: json(VendorCreateSchema) },
    responses: { 201: ok('The new vendor.', VendorSchema), 400: error('Invalid body (rule: validation_error).') },
  },
  {
    method: 'get',
    path: '/vendors/{vendorId}/exposure',
    tags: ['Vendors'],
    summary: 'Get what the business owes a vendor',
    description: 'open_ap_liability is the sum of total_amount over the vendor\'s approved invoices (rule: vendor_exposure_math).',
    request: { params: vendorId },
    responses: { 200: ok('Vendor exposure.', VendorExposureSchema), 404: error('Vendor not found.') },
  },
  {
    method: 'get',
    path: '/skus',
    tags: ['Catalog'],
    summary: 'List the SKU catalog',
    responses: { 200: ok('All SKUs.', z.array(SkuSchema)) },
  },
  {
    method: 'post',
    path: '/purchase-orders',
    tags: ['Purchase orders'],
    summary: 'Create a draft purchase order',
    description: 'The vendor must exist and be active (rule: inactive_vendor_gate). Each SKU may appear once.',
    request: { body: json(PurchaseOrderCreateSchema) },
    responses: {
      201: ok('The new draft purchase order.', PurchaseOrderSchema),
      400: error('Invalid body or inactive vendor.'),
      404: error('Vendor not found.'),
    },
  },
  {
    method: 'get',
    path: '/purchase-orders/{poId}',
    tags: ['Purchase orders'],
    summary: 'Get a purchase order',
    request: { params: poId },
    responses: { 200: ok('The purchase order.', PurchaseOrderSchema), 404: error('Purchase order not found.') },
  },
  {
    method: 'post',
    path: '/purchase-orders/{poId}/submit',
    tags: ['Purchase orders'],
    summary: 'Submit a draft purchase order',
    description: 'Only a draft can be submitted (rule: workflow_gate).',
    request: { params: poId },
    responses: {
      200: ok('The submitted purchase order.', PurchaseOrderSchema),
      400: error('The purchase order is not a draft.'),
      404: error('Purchase order not found.'),
    },
  },
  {
    method: 'post',
    path: '/purchase-orders/{poId}/receive',
    tags: ['Purchase orders'],
    summary: 'Record goods received',
    description:
      'Only a submitted purchase order can receive goods (rule: workflow_gate). Received quantity per line can never exceed the ordered quantity (rule: receive_quantity_limit). The order closes when every line is fully received.',
    request: { params: poId, body: json(ReceiveRequestSchema) },
    responses: {
      200: ok('The updated purchase order.', PurchaseOrderSchema),
      400: error('Invalid body, wrong status or over-receipt.'),
      404: error('Purchase order not found.'),
    },
  },
  {
    method: 'post',
    path: '/invoices',
    tags: ['Invoices'],
    summary: 'Create a vendor invoice against a purchase order',
    description:
      'The purchase order must be submitted or closed (rule: workflow_gate). Invoice numbers are unique per vendor, compared case-insensitively and ignoring surrounding spaces (rule: duplicate_invoice_detection). Every SKU must be on the purchase order, once (rule: invoice_line_validation). Everything invoiced on the purchase order, quantities and total, can never exceed what was received (rule: overpayment_protection).',
    request: { body: json(InvoiceCreateSchema) },
    responses: {
      201: ok('The new invoice.', InvoiceSchema),
      400: error('Invalid body or a business rule rejected the invoice.'),
      404: error('Purchase order not found.'),
    },
  },
  {
    method: 'get',
    path: '/invoices/{invoiceId}',
    tags: ['Invoices'],
    summary: 'Get an invoice',
    request: { params: invoiceId },
    responses: { 200: ok('The invoice.', InvoiceSchema), 404: error('Invoice not found.') },
  },
  {
    method: 'post',
    path: '/invoices/{invoiceId}/match',
    tags: ['Invoices'],
    summary: 'Run the 3-way match',
    description:
      'Compares the purchase order, the goods received and the invoice. partial_receipt is true when any line of the purchase order is not fully received (rule: partial_receipt_flag). An approved invoice cannot be matched again (rule: workflow_gate).',
    request: { params: invoiceId },
    responses: {
      200: ok('The match result.', MatchResultSchema),
      400: error('The invoice is already approved.'),
      404: error('Invoice not found.'),
    },
  },
  {
    method: 'post',
    path: '/invoices/{invoiceId}/approve',
    tags: ['Invoices'],
    summary: 'Approve a matched invoice and post it to the ledger',
    description:
      'The invoice must be matched first (rule: three_way_match_gate) and can be approved once (rule: duplicate_approval). Approval posts a balanced ledger entry: debit 5000 Materials Expense, credit 2000 Accounts Payable (rule: gl_balance).',
    request: { params: invoiceId },
    responses: {
      200: ok('The approval result.', ApproveResultSchema),
      400: error('Not matched, or already approved.'),
      404: error('Invoice not found.'),
    },
  },
];

for (const route of routes) {
  registry.registerPath(route);
}

export const openApiDocument = new OpenApiGeneratorV31(registry.definitions).generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'P2P Practice API',
    version: '1.0.0',
    description:
      'A small purchase-to-pay API for practicing API testing. Data lives in memory and resets on restart or with POST /admin/reset. There is no authentication. Every rejected request returns {"detail": "...", "rule": "..."}; 404 responses have no rule.',
  },
  servers: [{ url: `http://localhost:${process.env.PORT ?? 8000}` }],
});
