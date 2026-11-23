'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const YAML = require('yaml');
const swaggerUiDist = require('swagger-ui-dist');
const { AppError } = require('./services');
const { graphqlHandler, SDL_PATH } = require('./graphql');
const { PROTO_PATH, grpcStatus } = require('./grpc');

const ROOT = path.join(__dirname, '..');
const OPENAPI_PATH = path.join(ROOT, 'docs', 'openapi.yaml');

function createApp({ services, grpcClient, info }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  // Разрешаем запросы из Postman / Swagger Editor / других источников (учебный стенд).
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.set('Access-Control-Expose-Headers', 'Location, X-Transport, X-Grpc-Method');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/health', (req, res) => res.json({ status: 'ok', ...info }));

  /* ───────── №5. REST API телефонного справочника ───────── */
  const { contacts } = services;
  const q = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  app.get('/api/contacts', async (req, res) => res.json(await contacts.list(q(req.query.search))));
  app.get('/api/contacts/:id', async (req, res) => res.json(await contacts.get(req.params.id)));
  app.post('/api/contacts', async (req, res) => {
    const contact = await contacts.create(req.body);
    res.location(`/api/contacts/${contact.id}`).status(201).json(contact);
  });
  app.put('/api/contacts/:id', async (req, res) => res.json(await contacts.update(req.params.id, req.body, false)));
  app.patch('/api/contacts/:id', async (req, res) => res.json(await contacts.update(req.params.id, req.body, true)));
  app.delete('/api/contacts/:id', async (req, res) => {
    await contacts.remove(req.params.id);
    res.sendStatus(204);
  });

  /* ───────── №6. API магазина игр, реализованный по OpenAPI-спецификации ───────── */
  const { games } = services;
  app.get('/api/games', async (req, res) => {
    const maxPrice = q(req.query.maxPrice);
    if (maxPrice !== undefined && Number.isNaN(Number(maxPrice))) throw new AppError('maxPrice должен быть числом');
    res.json(
      await games.list({
        genre: q(req.query.genre),
        platform: q(req.query.platform),
        search: q(req.query.search),
        maxPrice: maxPrice === undefined ? undefined : Number(maxPrice),
      }),
    );
  });
  app.get('/api/games/:id', async (req, res) => res.json(await games.get(req.params.id)));
  app.post('/api/games', async (req, res) => {
    const game = await games.create(req.body);
    res.location(`/api/games/${game.id}`).status(201).json(game);
  });
  app.put('/api/games/:id', async (req, res) => res.json(await games.update(req.params.id, req.body)));
  app.delete('/api/games/:id', async (req, res) => {
    await games.remove(req.params.id);
    res.sendStatus(204);
  });
  app.post('/api/games/:id/orders', async (req, res) => res.status(201).json(await games.buy(req.params.id, req.body)));

  // Документация: спецификация, ReDoc, Swagger UI
  app.get('/openapi.yaml', (req, res) => res.type('application/yaml').sendFile(OPENAPI_PATH));
  // Для Swagger UI первым сервером ставим текущий адрес сайта, чтобы «Try it out» работал после деплоя.
  app.get('/openapi.json', (req, res) => {
    const spec = YAML.parse(fs.readFileSync(OPENAPI_PATH, 'utf8'));
    spec.servers = [{ url: '/', description: 'Текущий сервер' }, ...spec.servers];
    res.json(spec);
  });
  app.get(['/docs', '/redoc'], (req, res) => res.sendFile(path.join(ROOT, 'docs', 'redoc.html')));
  app.get('/docs/redoc.standalone.js', (req, res) =>
    res.sendFile(require.resolve('redoc/bundles/redoc.standalone.js')),
  );
  app.get('/swagger', (req, res) => res.sendFile(path.join(ROOT, 'docs', 'swagger.html')));
  app.use('/swagger-ui', express.static(swaggerUiDist.getAbsoluteFSPath()));

  /* ───────── №7. GraphQL ───────── */
  app.post('/graphql', graphqlHandler(services.library));
  app.get('/graphql/schema', (req, res) => res.type('text/plain; charset=utf-8').sendFile(SDL_PATH));
  app.get(['/graphql', '/graphiql'], (req, res) => res.sendFile(path.join(ROOT, 'public', 'graphiql.html')));

  /* ───────── №8. HTTP → gRPC шлюз ─────────
   * Браузер не умеет вызывать нативный gRPC (HTTP/2 trailers), поэтому страница
   * обращается к шлюзу /rpc/*, а шлюз — настоящий gRPC-клиент TaskService. */
  const rpc = async (res, method, request) => {
    res.set('X-Transport', 'gRPC');
    res.set('X-Grpc-Method', `planner.TaskService/${method[0].toUpperCase()}${method.slice(1)}`);
    try {
      return await grpcClient.call(method, request);
    } catch (error) {
      const map = {
        [grpcStatus.INVALID_ARGUMENT]: 400,
        [grpcStatus.NOT_FOUND]: 404,
        [grpcStatus.DEADLINE_EXCEEDED]: 504,
        [grpcStatus.UNAVAILABLE]: 503,
      };
      const status = map[error.code] || 500;
      throw new AppError(status === 503 ? 'gRPC-сервер недоступен' : error.details || 'Ошибка gRPC', status);
    }
  };
  const PRIORITY = ['LOW', 'MEDIUM', 'HIGH'];
  function rpcBody(body, update) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Ожидается JSON-объект');
    const allowed = update ? ['title', 'description', 'date', 'time', 'priority', 'done'] : ['title', 'description', 'date', 'time', 'priority'];
    const out = {};
    for (const [key, value] of Object.entries(body)) {
      if (!allowed.includes(key)) throw new AppError(`Неизвестное поле: ${key}`);
      if (key === 'done' ? typeof value !== 'boolean' : typeof value !== 'string') throw new AppError(`Неверный тип поля ${key}`);
      if (key === 'priority' && !PRIORITY.includes(value)) throw new AppError('priority: LOW, MEDIUM или HIGH');
      out[key] = value;
    }
    return out;
  }
  app.get('/rpc/tasks', async (req, res) => {
    const reply = await rpc(res, 'listTasks', { date: q(req.query.date) || '', onlyPending: req.query.onlyPending === 'true' });
    res.json(reply.tasks);
  });
  app.get('/rpc/stats', async (req, res) => res.json(await rpc(res, 'getDayStats', { date: q(req.query.date) || '' })));
  app.get('/rpc/tasks/:id', async (req, res) => res.json(await rpc(res, 'getTask', { id: req.params.id })));
  app.post('/rpc/tasks', async (req, res) => res.status(201).json(await rpc(res, 'createTask', rpcBody(req.body, false))));
  app.patch('/rpc/tasks/:id', async (req, res) =>
    res.json(await rpc(res, 'updateTask', { ...rpcBody(req.body, true), id: req.params.id })),
  );
  app.delete('/rpc/tasks/:id', async (req, res) => {
    await rpc(res, 'deleteTask', { id: req.params.id });
    res.sendStatus(204);
  });
  app.get('/rpc/proto', (req, res) => res.type('text/plain; charset=utf-8').sendFile(PROTO_PATH));

  /* ───────── Веб-клиент ───────── */
  app.use(express.static(path.join(ROOT, 'public')));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Маршрут не найден' }));
  app.use((req, res) => res.status(404).sendFile(path.join(ROOT, 'public', 'index.html')));
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    let status = 500;
    let message = 'Внутренняя ошибка сервера';
    if (error instanceof AppError) [status, message] = [error.status, error.message];
    else if (error.type === 'entity.parse.failed') [status, message] = [400, 'Некорректный JSON'];
    else if (error.type === 'entity.too.large') [status, message] = [413, 'Слишком большой запрос'];
    else console.error(error);
    res.status(status).json({ error: message });
  });
  return app;
}

module.exports = { createApp };
