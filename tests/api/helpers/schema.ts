import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { APIRequestContext } from '@playwright/test';

type OpenApiComponents = {
  schemas?: Record<string, unknown>;
};

type OpenApiDocument = {
  components?: OpenApiComponents;
};

const OPENAPI_SCHEMA_ID = 'openapi';

let ajvInit: Promise<{ ajv: Ajv; doc: OpenApiDocument }> | undefined;

async function getAjv(request: APIRequestContext): Promise<{ ajv: Ajv; doc: OpenApiDocument }> {
  if (!ajvInit) {
    ajvInit = (async () => {
      const response = await request.get('/openapi.json');
      if (!response.ok()) {
        throw new Error(`GET /openapi.json failed: ${response.status()} ${response.statusText()}`);
      }
      const doc = (await response.json()) as OpenApiDocument;
      const ajv = new Ajv({ strict: false, allErrors: true });
      ajv.addSchema(doc, OPENAPI_SCHEMA_ID);
      return { ajv, doc };
    })();
  }
  return ajvInit;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) {
    return '(no Ajv error details)';
  }
  return errors
    .map((err) => {
      const path = err.instancePath || '/';
      return `  ${path}: ${err.message ?? 'validation failed'}`;
    })
    .join('\n');
}

function getValidator(ajv: Ajv, name: string): ValidateFunction {
  const ref = `${OPENAPI_SCHEMA_ID}#/components/schemas/${name}`;
  const validate = ajv.getSchema(ref);
  if (!validate) {
    throw new Error(`Could not compile OpenAPI schema components/schemas/${name} (${ref})`);
  }
  return validate;
}

/**
 * Asserts that `body` matches `openapi#/components/schemas/<name>`.
 */
export async function expectSchema(
  request: APIRequestContext,
  body: unknown,
  name: string,
): Promise<void> {
  const { ajv, doc } = await getAjv(request);
  const schemas = doc.components?.schemas;
  if (!schemas || !(name in schemas)) {
    throw new Error(
      `OpenAPI components/schemas/${name} does not exist. Look up the $ref under paths → responses in /openapi.json.`,
    );
  }

  const validate = getValidator(ajv, name);
  if (!validate(body)) {
    throw new Error(`Body does not match schema ${name}:\n${formatAjvErrors(validate.errors)}`);
  }
}
