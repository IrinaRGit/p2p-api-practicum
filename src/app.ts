import express, { type NextFunction, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { openApiDocument } from './openapi.js';
import { NotFound, RuleViolation } from './rules.js';
import {
  InvoiceCreateSchema,
  PurchaseOrderCreateSchema,
  ReceiveRequestSchema,
  VendorCreateSchema,
} from './schemas.js';
import { store } from './store.js';

function parse<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return schema.parse(body ?? {});
}

function describeZodError(error: ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/admin/reset', (_req, res) => {
    store.seed();
    res.json({ status: 'reset' });
  });

  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: 'P2P Practice API' }));

  app.get('/vendors', (_req, res) => {
    res.json(store.listVendors());
  });

  app.post('/vendors', (req, res) => {
    const body = parse(VendorCreateSchema, req.body);
    res.status(201).json(store.createVendor(body.name, body.active));
  });

  app.get('/vendors/:vendorId/exposure', (req, res) => {
    res.json(store.exposure(req.params.vendorId));
  });

  app.get('/skus', (_req, res) => {
    res.json(store.listSkus());
  });

  app.post('/purchase-orders', (req, res) => {
    const body = parse(PurchaseOrderCreateSchema, req.body);
    res.status(201).json(store.createOrder(body.vendor_id, body.line_items));
  });

  app.get('/purchase-orders/:poId', (req, res) => {
    res.json(store.viewOrder(req.params.poId));
  });

  app.post('/purchase-orders/:poId/submit', (req, res) => {
    res.json(store.submitOrder(req.params.poId));
  });

  app.post('/purchase-orders/:poId/receive', (req, res) => {
    const body = parse(ReceiveRequestSchema, req.body);
    res.json(store.receive(req.params.poId, body.items));
  });

  app.post('/invoices', (req, res) => {
    const body = parse(InvoiceCreateSchema, req.body);
    res.status(201).json(store.createInvoice(body.po_id, body.invoice_number, body.line_items));
  });

  app.get('/invoices/:invoiceId', (req, res) => {
    res.json(store.viewInvoice(req.params.invoiceId));
  });

  app.post('/invoices/:invoiceId/match', (req, res) => {
    res.json(store.match(req.params.invoiceId));
  });

  app.post('/invoices/:invoiceId/approve', (req, res) => {
    res.json(store.approve(req.params.invoiceId));
  });

  app.use((req, res) => {
    res.status(404).json({ detail: `Route ${req.method} ${req.path} not found.` });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ detail: describeZodError(err), rule: 'validation_error' });
      return;
    }
    if (err instanceof RuleViolation) {
      res.status(400).json({ detail: err.message, rule: err.rule });
      return;
    }
    if (err instanceof NotFound) {
      res.status(404).json({ detail: err.message });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ detail: 'Request body is not valid JSON.', rule: 'validation_error' });
      return;
    }
    console.error(err);
    res.status(500).json({ detail: 'Internal server error.' });
  });

  return app;
}
