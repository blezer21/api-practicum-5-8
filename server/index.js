'use strict';
/**
 * Точка входа: один процесс поднимает
 *   - HTTP-сервер (сайт, REST, OpenAPI-документацию, GraphQL, шлюз к gRPC) — PORT (3000);
 *   - gRPC-сервер TaskService — GRPC_ADDRESS (127.0.0.1:50051).
 */
const { openDatabase } = require('./storage');
const { createServices } = require('./services');
const { createApp } = require('./app');
const { startGrpcServer, createGrpcClient } = require('./grpc');
const { seed } = require('./seed');

async function start(options = {}) {
  const env = { ...process.env, ...options };
  const port = Number(env.PORT ?? 3000);
  const host = env.HOST || '0.0.0.0';
  const grpcAddress = env.GRPC_ADDRESS || '127.0.0.1:50051';
  const grpcExternal = String(env.GRPC_EXTERNAL) === 'true';

  const db = await openDatabase({ mongoUri: env.MONGODB_URI, mongoDb: env.MONGODB_DB, file: env.DATA_FILE || './data/db.json' });
  const services = createServices(db);
  if (env.SEED !== 'false') await seed(services, db);

  let grpcServer = null;
  let clientAddress = grpcAddress;
  if (!grpcExternal) {
    grpcServer = await startGrpcServer(services.tasks, grpcAddress, { log: env.GRPC_LOG !== 'false' });
    clientAddress = `127.0.0.1:${grpcServer.port}`;
  }
  const grpcClient = createGrpcClient(clientAddress);

  const app = createApp({
    services,
    grpcClient,
    info: { storage: db.kind, grpc: clientAddress, grpcMode: grpcExternal ? 'внешний процесс' : 'в этом процессе' },
  });
  const http = await new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.on('error', reject);
  });

  return {
    port: http.address().port,
    grpcPort: grpcServer?.port,
    async stop() {
      await new Promise(resolve => http.close(resolve));
      grpcClient.close();
      if (grpcServer) await grpcServer.close();
      await db.close();
    },
    storage: db.kind,
  };
}

if (require.main === module) {
  start()
    .then(app => {
      console.log('──────────────────────────────────────────────');
      console.log(` Сайт:            http://localhost:${app.port}`);
      console.log(` №5 REST:         http://localhost:${app.port}/api/contacts`);
      console.log(` №6 ReDoc:        http://localhost:${app.port}/docs`);
      console.log(` №6 Swagger UI:   http://localhost:${app.port}/swagger`);
      console.log(` №7 GraphiQL:     http://localhost:${app.port}/graphiql`);
      console.log(` №8 gRPC:         127.0.0.1:${app.grpcPort ?? '(внешний)'}`);
      console.log(` Хранилище:       ${app.storage}`);
      console.log('──────────────────────────────────────────────');
      const stop = () => app.stop().then(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch(err => {
      console.error('Не удалось запустить сервер:', err.message);
      process.exit(1);
    });
}

module.exports = { start };
