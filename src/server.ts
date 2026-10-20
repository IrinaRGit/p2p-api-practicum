import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8000);

const server = createApp().listen(port, () => {
  console.log(`P2P Practice API on http://localhost:${port}`);
  console.log(`Swagger UI:   http://localhost:${port}/docs`);
  console.log(`OpenAPI JSON: http://localhost:${port}/openapi.json`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other process or run: PORT=8001 npm start`);
    process.exit(1);
  }
  throw error;
});
