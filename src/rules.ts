import type { GlEntry, InvoiceLine, PoLine, RuleName, Vendor } from './schemas.js';

export class RuleViolation extends Error {
  constructor(
    public readonly rule: RuleName | 'validation_error',
    detail: string,
  ) {
    super(detail);
  }
}

export class NotFound extends Error {}

const EPSILON = 1e-9;
const ROUNDING_ALLOWANCE = 0.01;

export const EXPENSE_ACCOUNT = '5000 Materials Expense';
export const PAYABLE_ACCOUNT = '2000 Accounts Payable';

export function toCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function linesValue(lines: { quantity: number; unit_price: number }[]): number {
  return toCents(lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0));
}

export function receivedValue(lines: PoLine[]): number {
  return toCents(lines.reduce((sum, line) => sum + line.received_quantity * line.unit_price, 0));
}

export function isFullyReceived(lines: PoLine[]): boolean {
  return lines.every((line) => line.received_quantity + EPSILON >= line.quantity);
}

export function checkVendorActive(vendor: Vendor): void {
  if (!vendor.active) {
    throw new RuleViolation('inactive_vendor_gate', `Vendor ${vendor.id} is inactive. Purchase orders need an active vendor.`);
  }
}

export function checkReceiveWithinOrdered(line: PoLine, incoming: number): void {
  if (line.received_quantity + incoming > line.quantity + EPSILON) {
    throw new RuleViolation(
      'receive_quantity_limit',
      `Cannot receive ${incoming} of ${line.sku}: ordered ${line.quantity}, already received ${line.received_quantity}.`,
    );
  }
}

export function checkInvoiceNumberUnique(invoiceNumber: string, existingNumbers: string[]): void {
  if (existingNumbers.includes(invoiceNumber)) {
    throw new RuleViolation(
      'duplicate_invoice_detection',
      `Invoice number ${invoiceNumber} already exists for this vendor.`,
    );
  }
}

/**
 * Checks the new invoice lines against the PO lines and against what was already invoiced.
 * @param poLines lines of the purchase order
 * @param newLines lines of the invoice being created
 * @param invoicedBySku quantity already invoiced per SKU on this PO
 */
export function checkInvoiceLines(poLines: PoLine[], newLines: InvoiceLine[], invoicedBySku: Map<string, number>): void {
  const seen = new Set<string>();
  for (const line of newLines) {
    if (seen.has(line.sku)) {
      throw new RuleViolation('invoice_line_validation', `SKU ${line.sku} appears more than once on the invoice.`);
    }
    seen.add(line.sku);
    const poLine = poLines.find((candidate) => candidate.sku === line.sku);
    if (!poLine) {
      throw new RuleViolation('invoice_line_validation', `SKU ${line.sku} is not on the purchase order.`);
    }
    const alreadyInvoiced = invoicedBySku.get(line.sku) ?? 0;
    if (alreadyInvoiced + line.quantity > poLine.received_quantity + EPSILON) {
      throw new RuleViolation(
        'overpayment_protection',
        `Cannot invoice ${line.quantity} of ${line.sku}: received ${poLine.received_quantity}, already invoiced ${alreadyInvoiced}.`,
      );
    }
  }
}

/**
 * Checks that everything invoiced on the PO, including the new invoice, stays within the received value.
 * @param newTotal total of the invoice being created
 * @param alreadyInvoiced total of earlier invoices on the same PO
 * @param received value of goods received on the PO
 */
export function checkInvoiceTotal(newTotal: number, alreadyInvoiced: number, received: number): void {
  const limit = toCents(received * (1 + ROUNDING_ALLOWANCE));
  if (toCents(alreadyInvoiced + newTotal) > limit + EPSILON) {
    throw new RuleViolation(
      'overpayment_protection',
      `Invoice total ${newTotal.toFixed(2)} plus already invoiced ${alreadyInvoiced.toFixed(2)} exceeds received value ${received.toFixed(2)}.`,
    );
  }
}

export function hasPartialReceipt(poLines: PoLine[]): boolean {
  const [first] = poLines;
  return first.received_quantity + EPSILON < first.quantity;
}

export function checkNotApproved(status: string, invoiceId: string): void {
  if (status === 'approved') {
    throw new RuleViolation('duplicate_approval', `Invoice ${invoiceId} is already approved.`);
  }
}

export function checkMatched(matched: boolean, invoiceId: string): void {
  if (!matched) {
    throw new RuleViolation('three_way_match_gate', `Invoice ${invoiceId} must pass the 3-way match before approval.`);
  }
}

export function buildGlEntry(amount: number): GlEntry {
  const debits = [{ account: EXPENSE_ACCOUNT, amount: toCents(amount) }];
  const credits = [{ account: PAYABLE_ACCOUNT, amount: toCents(amount) }];
  const debitTotal = toCents(debits.reduce((sum, line) => sum + line.amount, 0));
  const creditTotal = toCents(credits.reduce((sum, line) => sum + line.amount, 0));
  return { debits, credits, balanced: Math.abs(debitTotal - creditTotal) < EPSILON };
}

export function checkGlBalanced(entry: GlEntry): void {
  if (!entry.balanced) {
    throw new RuleViolation('gl_balance', 'General ledger entry is not balanced: debits must equal credits.');
  }
}
