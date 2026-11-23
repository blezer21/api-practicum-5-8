'use strict';
// Отдельный процесс gRPC-сервера (npm run grpc:server).
// Сайт тогда запускается с GRPC_EXTERNAL=true и подключается к нему как клиент.
const { openDatabase } = require('../storage');
const { createServices } = require('../services');
const { startGrpcServer } = require('./index');

(async () => {
  const address = process.env.GRPC_ADDRESS || '127.0.0.1:50051';
  const db = await openDatabase({
    mongoUri: process.env.MONGODB_URI,
    mongoDb: process.env.MONGODB_DB,
    file: process.env.GRPC_DATA_FILE || './data/grpc-db.json',
  });
  const { tasks } = createServices(db);
  const grpcServer = await startGrpcServer(tasks, address);
  console.log(`gRPC TaskService слушает ${address} (хранилище: ${db.kind})`);
  const stop = async () => {
    await grpcServer.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
