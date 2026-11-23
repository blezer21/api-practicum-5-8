'use strict';
// Интеграционные тесты: поднимают сервер на свободных портах с временной базой.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const { start } = require('../server');
const { createGrpcClient } = require('../server/grpc');

let app;
let base;
let tmp;

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'api-practicum-'));
  app = await start({ PORT: 0, HOST: '127.0.0.1', GRPC_ADDRESS: '127.0.0.1:0', DATA_FILE: path.join(tmp, 'db.json'), GRPC_LOG: 'false' });
  base = `http://127.0.0.1:${app.port}`;
});
test.after(async () => {
  await app.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function req(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

test('№5 REST: полный CRUD контактов и ошибки', async () => {
  const created = await req('POST', '/api/contacts', { name: 'Тест', mobile: '+7 900 000-00-00' });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('location'), `/api/contacts/${created.body.id}`);
  const id = created.body.id;

  assert.equal((await req('POST', '/api/contacts', { name: 'Без телефона' })).status, 400);
  assert.equal((await req('PATCH', `/api/contacts/${id}`, { email: 'плохой' })).status, 400);
  assert.equal((await req('PATCH', `/api/contacts/${id}`, { email: 't@example.com' })).body.email, 't@example.com');
  assert.equal((await req('PUT', `/api/contacts/${id}`, { name: 'Новое имя', home: '+7 495 000-00-00' })).body.mobile, '');
  assert.equal((await req('GET', '/api/contacts?search=новое')).body.length, 1);
  assert.equal((await req('DELETE', `/api/contacts/${id}`)).status, 204);
  assert.equal((await req('GET', `/api/contacts/${id}`)).status, 404);
});

test('№6 OpenAPI: спецификация валидна по структуре, API ей соответствует', async () => {
  const spec = YAML.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'openapi.yaml'), 'utf8'));
  assert.equal(spec.openapi, '3.0.3');
  for (const p of ['/api/games', '/api/games/{id}', '/api/games/{id}/orders']) assert.ok(spec.paths[p], p);

  const game = await req('POST', '/api/games', { title: 'Тест', genre: 'indie', platforms: ['pc'], price: 100, stock: 1 });
  assert.equal(game.status, 201);
  assert.equal((await req('POST', '/api/games', { title: 'X', genre: 'нет', platforms: ['pc'], price: 1 })).status, 400);
  assert.ok((await req('GET', '/api/games?genre=indie')).body.some(g => g.id === game.body.id));
  const order = await req('POST', `/api/games/${game.body.id}/orders`, { quantity: 1 });
  assert.equal(order.status, 201);
  assert.equal(order.body.stockLeft, 0);
  assert.equal((await req('POST', `/api/games/${game.body.id}/orders`, { quantity: 1 })).status, 409);
  assert.equal((await req('DELETE', `/api/games/${game.body.id}`)).status, 204);
  assert.equal((await fetch(base + '/docs')).status, 200);
});

test('№7 GraphQL: запросы, вложенные поля и мутации', async () => {
  const gql = (query, variables) => req('POST', '/graphql', { query, variables }).then(r => r.body);
  const added = await gql('mutation($i: BookInput!) { addBook(input: $i) { id name author { id name } } }', {
    i: { name: 'Тестовая книга', genre: 'Тест', authorName: 'Автор Тестовый' },
  });
  assert.equal(added.data.addBook.author.name, 'Автор Тестовый');
  const id = added.data.addBook.id;

  const list = await gql('{ books(genre: "Тест") { name } }');
  assert.deepEqual(list.data.books, [{ name: 'Тестовая книга' }]); // только запрошенное поле

  const nested = await gql('query($id: ID!) { author(id: $id) { books { name } bookCount } }', { id: added.data.addBook.author.id });
  assert.equal(nested.data.author.bookCount, 1);

  const upd = await gql('mutation($id: ID!) { updateBook(id: $id, input: { available: false }) { available } }', { id });
  assert.equal(upd.data.updateBook.available, false);
  assert.ok((await gql('mutation { addBook(input: { name: "X", genre: "Y" }) { id } }')).errors);
  assert.equal((await gql('mutation($id: ID!) { deleteBook(id: $id) }', { id })).data.deleteBook, true);
});

test('№8 gRPC: CRUD напрямую через gRPC-клиент и через HTTP-шлюз', async () => {
  const client = createGrpcClient(`127.0.0.1:${app.grpcPort}`);
  try {
    const task = await client.call('createTask', { title: 'gRPC', date: '2030-01-01', priority: 'HIGH' });
    assert.equal(task.priority, 'HIGH');
    assert.equal((await client.call('updateTask', { id: task.id, done: true })).done, true);
    // явное false должно дойти до сервера благодаря optional в proto
    const undone = await client.call('updateTask', { id: task.id, done: false });
    assert.equal(undone.done, false);
    assert.equal(undone.title, 'gRPC');
    assert.equal((await client.call('listTasks', { date: '2030-01-01' })).tasks.length, 1);
    assert.deepEqual(await client.call('getDayStats', { date: '2030-01-01' }), { date: '2030-01-01', total: 1, done: 0 });
    await client.call('deleteTask', { id: task.id });
    await assert.rejects(client.call('getTask', { id: task.id }), err => err.code === 5); // NOT_FOUND
  } finally {
    client.close();
  }

  const viaGateway = await req('POST', '/rpc/tasks', { title: 'Через шлюз', date: '2030-01-02' });
  assert.equal(viaGateway.status, 201);
  assert.equal(viaGateway.headers.get('x-transport'), 'gRPC');
  assert.equal((await req('POST', '/rpc/tasks', { title: '', date: '2030-01-02' })).status, 400);
  assert.equal((await req('DELETE', `/rpc/tasks/${viaGateway.body.id}`)).status, 204);
});
