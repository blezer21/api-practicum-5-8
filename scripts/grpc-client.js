'use strict';
/**
 * №8. Консольный gRPC-клиент: выполняет полный CRUD-цикл над TaskService.
 * Запуск (при работающем npm start): npm run grpc:client
 */
const { createGrpcClient } = require('../server/grpc');

const address = process.env.GRPC_ADDRESS || '127.0.0.1:50051';
const client = createGrpcClient(address);
const today = new Date().toLocaleDateString('sv-SE');

async function step(title, method, request) {
  const reply = await client.call(method, request);
  console.log(`\n▶ ${title} — rpc ${method[0].toUpperCase()}${method.slice(1)}`);
  console.log('  запрос:', JSON.stringify(request));
  console.log('  ответ: ', JSON.stringify(reply, null, 2).replace(/\n/g, '\n          '));
  return reply;
}

(async () => {
  console.log(`Подключение к gRPC-серверу ${address}`);
  const created = await step('Создание задачи', 'createTask', { title: 'Задача из консольного клиента', date: today, time: '18:00', priority: 'HIGH' });
  await step('Чтение задачи', 'getTask', { id: created.id });
  await step('Изменение (отметка выполнения)', 'updateTask', { id: created.id, done: true, title: 'Задача из клиента (выполнена)' });
  const list = await client.call('listTasks', { date: today });
  console.log(`\n▶ Список задач на ${today} — rpc ListTasks: ${list.tasks.length} шт.`);
  for (const t of list.tasks) console.log(`  ${t.done ? '[x]' : '[ ]'} ${t.time || '--:--'} ${t.title} (${t.priority})`);
  await step('Статистика дня', 'getDayStats', { date: today });
  await step('Удаление задачи', 'deleteTask', { id: created.id });
  try {
    await client.call('getTask', { id: created.id });
  } catch (error) {
    console.log(`\n▶ Повторное чтение удалённой задачи → код ${error.code} (NOT_FOUND): ${error.details}`);
  }
  client.close();
})().catch(error => {
  console.error('Ошибка gRPC:', error.details || error.message, '\nЗапущен ли сервер (npm start)?');
  client.close();
  process.exit(1);
});
