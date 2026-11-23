'use strict';
/**
 * №8. gRPC: сервер TaskService и клиент к нему.
 * Транспорт — HTTP/2, сериализация — Protocol Buffers (@grpc/grpc-js).
 */
const path = require('node:path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { AppError } = require('../services');

const PROTO_PATH = path.join(__dirname, 'tasks.proto');
const definition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false, // only_pending → onlyPending
  enums: String, // Priority передаётся строкой: "HIGH"
  defaults: true,
  oneofs: true, // нужно для optional-полей в UpdateTaskRequest
});
const { TaskService } = grpc.loadPackageDefinition(definition).planner;

let logEnabled = true;
const UPDATABLE = ['title', 'description', 'date', 'time', 'priority', 'done'];

function toGrpcError(error) {
  if (error instanceof AppError) {
    const code = error.status === 404 ? grpc.status.NOT_FOUND : grpc.status.INVALID_ARGUMENT;
    return { code, details: error.message };
  }
  console.error(error);
  return { code: grpc.status.INTERNAL, details: 'Внутренняя ошибка сервера' };
}

const unary = fn => async (call, callback) => {
  const started = Date.now();
  try {
    const reply = await fn(call.request);
    callback(null, reply);
    log(call, 'OK', started);
  } catch (error) {
    callback(toGrpcError(error));
    log(call, error.message, started);
  }
};

function log(call, result, started) {
  if (logEnabled) {
    console.log(`[gRPC] ${call.getPath()} → ${result} (${Date.now() - started} мс)`);
  }
}

async function startGrpcServer(tasks, address, { log = process.env.GRPC_LOG !== 'false' } = {}) {
  logEnabled = log;
  const server = new grpc.Server();
  server.addService(TaskService.service, {
    listTasks: unary(async ({ date, onlyPending }) => ({ tasks: await tasks.list({ date, onlyPending }) })),
    getTask: unary(({ id }) => tasks.get(id)),
    createTask: unary(request => tasks.create(request)),
    updateTask: unary(request => {
      const changes = {};
      for (const key of UPDATABLE) if (Object.hasOwn(request, key)) changes[key] = request[key];
      return tasks.update(request.id, changes);
    }),
    deleteTask: unary(async ({ id }) => {
      await tasks.remove(id);
      return { deleted: true };
    }),
    getDayStats: unary(async ({ date }) => ({ date, ...(await tasks.stats(date)) })),
  });
  const port = await new Promise((resolve, reject) =>
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p))),
  );
  return {
    port,
    close: () => new Promise(resolve => server.tryShutdown(() => resolve())),
  };
}

function createGrpcClient(address) {
  const client = new TaskService(address, grpc.credentials.createInsecure());
  return {
    call(method, request) {
      return new Promise((resolve, reject) => {
        client[method](request, { deadline: Date.now() + 5000 }, (err, reply) => (err ? reject(err) : resolve(reply)));
      });
    },
    close: () => client.close(),
  };
}

module.exports = { startGrpcServer, createGrpcClient, PROTO_PATH, grpcStatus: grpc.status };
