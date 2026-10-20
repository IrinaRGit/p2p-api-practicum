import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const RULES = [
  'inactive_vendor_gate',
  'receive_quantity_limit',
  'overpayment_protection',
  'three_way_match_gate',
  'partial_receipt_flag',
  'duplicate_invoice_detection',
  'gl_balance',
  'invoice_line_validation',
  'duplicate_approval',
  'workflow_gate',
  'vendor_exposure_math',
] as const;

export type RuleName = (typeof RULES)[number];

const money = z.number().openapi({ example: 47.5, description: 'Amount in dollars, rounded to cents.' });

export const ErrorSchema = z
  .object({
    detail: z.string().openapi({ example: 'Vendor vnd-002 is inactive.' }),
    rule: z
      .enum([...RULES, 'validation_error'])
      .optional()
      .openapi({ description: 'The business rule that rejected the request. Missing on 404 responses.' }),
  })
  .openapi('Error');

export const HealthSchema = z.object({ status: z.literal('ok') }).openapi('Health');
export const ResetSchema = z.object({ status: z.literal('reset') }).openapi('Reset');

export const VendorSchema = z
  .object({
    id: z.string().openapi({ example: 'vnd-001' }),
    name: z.string().openapi({ example: 'Maple Ridge Supply' }),
    active: z.boolean(),
  })
  .openapi('Vendor');

export const VendorCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'name must not be empty'),
    active: z.boolean().default(true),
  })
  .openapi('VendorCreate');

export const SkuSchema = z
  .object({
    sku: z.string().openapi({ example: 'LUM-2X4-8' }),
    description: z.string().openapi({ example: '2x4 stud, 8 ft' }),
    unit_price: money,
  })
  .openapi('Sku');

const quantity = z
  .number()
  .positive('quantity must be greater than 0')
  .max(10000, 'quantity must be 10000 or less')
  .openapi({ example: 10 });
const unitPrice = z
  .number()
  .nonnegative('unit_price must be 0 or more')
  .max(100000, 'unit_price must be 100000 or less')
  .openapi({ example: 4.75 });

export const PoLineCreateSchema = z
  .object({
    sku: z.string().trim().min(1, 'sku must not be empty'),
    description: z.string().default(''),
    quantity,
    unit_price: unitPrice,
  })
  .openapi('PoLineCreate');

export const PurchaseOrderCreateSchema = z
  .object({
    vendor_id: z.string().min(1, 'vendor_id must not be empty'),
    line_items: z.array(PoLineCreateSchema).min(1, 'line_items must have at least one line'),
  })
  .openapi('PurchaseOrderCreate');

export const PoLineSchema = z
  .object({
    sku: z.string(),
    description: z.string(),
    quantity: z.number(),
    unit_price: money,
    received_quantity: z.number(),
  })
  .openapi('PoLine');

export const PurchaseOrderSchema = z
  .object({
    id: z.string().openapi({ example: 'po-1a2b3c4d' }),
    vendor_id: z.string(),
    status: z.enum(['draft', 'submitted', 'closed']),
    line_items: z.array(PoLineSchema),
    ordered_value: money,
    received_value: money,
    fully_received: z.boolean(),
  })
  .openapi('PurchaseOrder');

export const ReceiveRequestSchema = z
  .object({
    items: z
      .array(
        z.object({
          sku: z.string().trim().min(1, 'sku must not be empty'),
          quantity,
        }),
      )
      .min(1, 'items must have at least one line'),
  })
  .openapi('ReceiveRequest');

export const InvoiceLineSchema = z
  .object({
    sku: z.string().trim().min(1, 'sku must not be empty'),
    quantity,
    unit_price: unitPrice,
  })
  .openapi('InvoiceLine');

export const InvoiceCreateSchema = z
  .object({
    po_id: z.string().min(1, 'po_id must not be empty'),
    invoice_number: z.string().min(1, 'invoice_number must not be empty').openapi({ example: 'INV-1001' }),
    line_items: z.array(InvoiceLineSchema).min(1, 'line_items must have at least one line'),
  })
  .openapi('InvoiceCreate');

export const InvoiceSchema = z
  .object({
    id: z.string().openapi({ example: 'inv-5e6f7a8b' }),
    po_id: z.string(),
    vendor_id: z.string(),
    invoice_number: z.string(),
    status: z.enum(['received', 'matched', 'approved']),
    line_items: z.array(InvoiceLineSchema),
    total_amount: money,
    matched: z.boolean(),
    partial_receipt: z.boolean().nullable().openapi({ description: 'null until the invoice is matched.' }),
  })
  .openapi('Invoice');

export const MatchResultSchema = z
  .object({
    invoice_id: z.string(),
    po_id: z.string(),
    status: z.literal('matched'),
    matched: z.literal(true),
    partial_receipt: z.boolean(),
    ordered_value: money,
    received_value: money,
    invoice_total: money,
    message: z.string().openapi({ example: '3-way match passed.' }),
  })
  .openapi('MatchResult');

export const GlLineSchema = z
  .object({
    account: z.string().openapi({ example: '5000 Materials Expense' }),
    amount: money,
  })
  .openapi('GlLine');

export const GlEntrySchema = z
  .object({
    debits: z.array(GlLineSchema),
    credits: z.array(GlLineSchema),
    balanced: z.boolean(),
  })
  .openapi('GlEntry');

export const ApproveResultSchema = z
  .object({
    invoice_id: z.string(),
    status: z.literal('approved'),
    gl_entry: GlEntrySchema,
    vendor_exposure: money,
  })
  .openapi('ApproveResult');

export const VendorExposureSchema = z
  .object({
    vendor_id: z.string(),
    open_ap_liability: money,
    approved_invoices: z.array(z.string()),
  })
  .openapi('VendorExposure');

export type Vendor = z.infer<typeof VendorSchema>;
export type Sku = z.infer<typeof SkuSchema>;
export type PoLine = z.infer<typeof PoLineSchema>;
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;
export type GlEntry = z.infer<typeof GlEntrySchema>;
