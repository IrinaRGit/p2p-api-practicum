import { randomBytes } from 'node:crypto';
import {
  NotFound,
  RuleViolation,
  buildGlEntry,
  checkGlBalanced,
  checkInvoiceLines,
  checkInvoiceNumberUnique,
  checkInvoiceTotal,
  checkMatched,
  checkNotApproved,
  checkReceiveWithinOrdered,
  checkVendorActive,
  hasPartialReceipt,
  isFullyReceived,
  linesValue,
  receivedValue,
  toCents,
} from './rules.js';
import type { GlEntry, InvoiceLine, PoLine, Sku, Vendor } from './schemas.js';

type PoStatus = 'draft' | 'submitted' | 'closed';
type InvoiceStatus = 'received' | 'matched' | 'approved';

interface PurchaseOrder {
  id: string;
  vendor_id: string;
  status: PoStatus;
  line_items: PoLine[];
}

interface Invoice {
  id: string;
  po_id: string;
  vendor_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  line_items: InvoiceLine[];
  total_amount: number;
  matched: boolean;
  partial_receipt: boolean | null;
}

const SEED_VENDORS: Vendor[] = [
  { id: 'vnd-001', name: 'Maple Ridge Supply', active: true },
  { id: 'vnd-002', name: 'Old Quarry Materials', active: false },
];

const SEED_SKUS: Sku[] = [
  { sku: 'LUM-2X4-8', description: '2x4 stud, 8 ft', unit_price: 4.75 },
  { sku: 'PLY-12-4X8', description: 'Plywood sheet, 1/2 in, 4x8 ft', unit_price: 22.4 },
  { sku: 'CEM-30KG', description: 'Cement bag, 30 kg', unit_price: 11.9 },
  { sku: 'REB-10MM-6', description: 'Rebar, 10 mm, 6 m', unit_price: 18.25 },
  { sku: 'SCR-DECK-1LB', description: 'Deck screws, 1 lb box', unit_price: 9.99 },
];

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

class Store {
  private vendors = new Map<string, Vendor>();
  private skus = new Map<string, Sku>();
  private orders = new Map<string, PurchaseOrder>();
  private invoices = new Map<string, Invoice>();

  constructor() {
    this.seed();
  }

  seed(): void {
    this.vendors = new Map(SEED_VENDORS.map((vendor) => [vendor.id, { ...vendor }]));
    this.skus = new Map(SEED_SKUS.map((sku) => [sku.sku, { ...sku }]));
    this.orders = new Map();
    this.invoices = new Map();
  }

  listVendors(): Vendor[] {
    return [...this.vendors.values()];
  }

  createVendor(name: string, active: boolean): Vendor {
    const vendor = { id: newId('vnd'), name, active };
    this.vendors.set(vendor.id, vendor);
    return vendor;
  }

  listSkus(): Sku[] {
    return [...this.skus.values()];
  }

  private vendor(id: string): Vendor {
    const vendor = this.vendors.get(id);
    if (!vendor) throw new NotFound(`Vendor ${id} not found.`);
    return vendor;
  }

  private order(id: string): PurchaseOrder {
    const order = this.orders.get(id);
    if (!order) throw new NotFound(`Purchase order ${id} not found.`);
    return order;
  }

  private invoice(id: string): Invoice {
    const invoice = this.invoices.get(id);
    if (!invoice) throw new NotFound(`Invoice ${id} not found.`);
    return invoice;
  }

  private invoicesFor(poId: string): Invoice[] {
    return [...this.invoices.values()].filter((invoice) => invoice.po_id === poId);
  }

  viewOrder(id: string) {
    const order = this.order(id);
    return {
      id: order.id,
      vendor_id: order.vendor_id,
      status: order.status,
      line_items: order.line_items.map((line) => ({ ...line })),
      ordered_value: linesValue(order.line_items),
      received_value: receivedValue(order.line_items),
      fully_received: isFullyReceived(order.line_items),
    };
  }

  viewInvoice(id: string) {
    const invoice = this.invoice(id);
    return { ...invoice, line_items: invoice.line_items.map((line) => ({ ...line })) };
  }

  createOrder(vendorId: string, lines: { sku: string; description: string; quantity: number; unit_price: number }[]) {
    const vendor = this.vendor(vendorId);
    checkVendorActive(vendor);
    const skus = lines.map((line) => line.sku);
    if (new Set(skus).size !== skus.length) {
      throw new RuleViolation('validation_error', 'Each SKU may appear only once on a purchase order.');
    }
    const order: PurchaseOrder = {
      id: newId('po'),
      vendor_id: vendor.id,
      status: 'draft',
      line_items: lines.map((line) => ({ ...line, unit_price: toCents(line.unit_price), received_quantity: 0 })),
    };
    this.orders.set(order.id, order);
    return this.viewOrder(order.id);
  }

  submitOrder(id: string) {
    const order = this.order(id);
    if (order.status !== 'draft') {
      throw new RuleViolation('workflow_gate', `Only draft purchase orders can be submitted. ${id} is ${order.status}.`);
    }
    order.status = 'submitted';
    return this.viewOrder(id);
  }

  receive(id: string, items: { sku: string; quantity: number }[]) {
    const order = this.order(id);
    if (order.status !== 'submitted') {
      throw new RuleViolation('workflow_gate', `Goods can only be received on a submitted purchase order. ${id} is ${order.status}.`);
    }
    const incoming = new Map<string, number>();
    for (const item of items) {
      if (!order.line_items.some((line) => line.sku === item.sku)) {
        throw new RuleViolation('validation_error', `SKU ${item.sku} is not on purchase order ${id}.`);
      }
      incoming.set(item.sku, (incoming.get(item.sku) ?? 0) + item.quantity);
    }
    for (const [sku, quantity] of incoming) {
      const line = order.line_items.find((candidate) => candidate.sku === sku) as PoLine;
      checkReceiveWithinOrdered(line, quantity);
    }
    for (const [sku, quantity] of incoming) {
      const line = order.line_items.find((candidate) => candidate.sku === sku) as PoLine;
      line.received_quantity += quantity;
    }
    if (isFullyReceived(order.line_items)) {
      order.status = 'closed';
    }
    return this.viewOrder(id);
  }

  createInvoice(poId: string, invoiceNumber: string, lines: InvoiceLine[]) {
    const order = this.order(poId);
    if (order.status === 'draft') {
      throw new RuleViolation('workflow_gate', `Purchase order ${poId} is still a draft. Submit it before invoicing.`);
    }
    const vendorNumbers = [...this.invoices.values()]
      .filter((invoice) => invoice.vendor_id === order.vendor_id)
      .map((invoice) => invoice.invoice_number);
    checkInvoiceNumberUnique(invoiceNumber, vendorNumbers);

    const earlier = this.invoicesFor(poId);
    const invoicedBySku = new Map<string, number>();
    for (const invoice of earlier) {
      for (const line of invoice.line_items) {
        invoicedBySku.set(line.sku, (invoicedBySku.get(line.sku) ?? 0) + line.quantity);
      }
    }
    checkInvoiceLines(order.line_items, lines, invoicedBySku);

    const total = linesValue(lines);
    const alreadyInvoiced = toCents(earlier.reduce((sum, invoice) => sum + invoice.total_amount, 0));
    checkInvoiceTotal(total, alreadyInvoiced, receivedValue(order.line_items));

    const invoice: Invoice = {
      id: newId('inv'),
      po_id: poId,
      vendor_id: order.vendor_id,
      invoice_number: invoiceNumber,
      status: 'received',
      line_items: lines.map((line) => ({ ...line })),
      total_amount: total,
      matched: false,
      partial_receipt: null,
    };
    this.invoices.set(invoice.id, invoice);
    return this.viewInvoice(invoice.id);
  }

  match(id: string) {
    const invoice = this.invoice(id);
    if (invoice.status === 'approved') {
      throw new RuleViolation('workflow_gate', `Invoice ${id} is already approved and cannot be matched again.`);
    }
    const order = this.order(invoice.po_id);
    const partial = hasPartialReceipt(order.line_items);
    invoice.matched = true;
    invoice.partial_receipt = partial;
    invoice.status = 'matched';
    return {
      invoice_id: invoice.id,
      po_id: order.id,
      status: 'matched' as const,
      matched: true as const,
      partial_receipt: partial,
      ordered_value: linesValue(order.line_items),
      received_value: receivedValue(order.line_items),
      invoice_total: invoice.total_amount,
      message: partial ? '3-way match passed. Partial receipt flagged.' : '3-way match passed.',
    };
  }

  approve(id: string): { invoice_id: string; status: 'approved'; gl_entry: GlEntry; vendor_exposure: number } {
    const invoice = this.invoice(id);
    checkNotApproved(invoice.status, id);
    checkMatched(invoice.matched, id);
    const entry = buildGlEntry(invoice.total_amount);
    checkGlBalanced(entry);
    invoice.status = 'approved';
    return {
      invoice_id: invoice.id,
      status: 'approved',
      gl_entry: entry,
      vendor_exposure: this.exposure(invoice.vendor_id).open_ap_liability,
    };
  }

  exposure(vendorId: string) {
    this.vendor(vendorId);
    const approved = [...this.invoices.values()].filter(
      (invoice) => invoice.vendor_id === vendorId && invoice.status === 'approved',
    );
    return {
      vendor_id: vendorId,
      open_ap_liability: toCents(approved.reduce((sum, invoice) => sum + invoice.total_amount, 0)),
      approved_invoices: approved.map((invoice) => invoice.id),
    };
  }
}

export const store = new Store();
