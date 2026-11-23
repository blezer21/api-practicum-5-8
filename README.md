# Практические работы 5–8 — «Интерфейсы прикладного программирования»

Один сайт на **Node.js + Express**, четыре раздела в боковом меню:

| № | Тема | Что сделано | Файлы |
|---|---|---|---|
| 05 | REST API (CRUD) | Телефонный справочник: список, поиск, создание, изменение (PUT/PATCH), удаление. MongoDB или JSON-файл. Готов к деплою на Heroku | `server/app.js`, `server/services.js`, `server/storage.js` |
| 06 | OpenAPI · ReDoc · Prism | API **магазина компьютерных игр**: спецификация OpenAPI 3.0 на YAML, документация ReDoc и Swagger UI, mock-сервер Prism, настоящая реализация на Express | `docs/openapi.yaml`, `docs/redoc.html` |
| 07 | GraphQL, **вариант 1** | Библиотека книг: схема на SDL (книга `id`, `name`, `genre` + автор `name`), сервер, веб-клиент и GraphiQL | `server/graphql/` |
| 08 | gRPC, **вариант 3** | Список личных задач на день: `.proto`, gRPC-сервер, gRPC-клиент, CRUD + отметка выполнения + статистика дня | `server/grpc/`, `scripts/grpc-client.js` |

Под каждым разделом есть **журнал запросов к API**: метод, адрес, статус, тело запроса и ответа.
Для gRPC там же видно, какой rpc-метод был вызван. Удобно для скриншотов в отчёт.

## Запуск

Нужен Node.js 22.9 или новее.

```sh
npm install
npm start
```

Откройте **http://localhost:3000**. Команда `npm start` поднимает сразу два сервера:
HTTP на порту 3000 и gRPC на порту 50051.

| Адрес | Что там |
|---|---|
| http://localhost:3000 | Сайт (разделы 05–08) |
| http://localhost:3000/api/contacts | REST API №5 |
| http://localhost:3000/docs | ReDoc №6 |
| http://localhost:3000/swagger | Swagger UI №6 (Try it out) |
| http://localhost:3000/openapi.yaml | Спецификация OpenAPI |
| http://localhost:3000/graphiql | GraphiQL №7 |
| http://localhost:3000/graphql/schema | Схема GraphQL (SDL) |
| http://localhost:3000/rpc/proto | Файл `tasks.proto` №8 |

При первом запуске добавляются демонстрационные данные. Всё хранится в `data/db.json`.
Чтобы начать с пустой базы, удалите этот файл.

### MongoDB (как в методичке к №5)

Создайте файл `.env` по образцу `.env.example` и укажите:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=api_practicum
```

После `npm start` внизу бокового меню будет написано «MongoDB».

## №5 — REST

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/api/contacts?search=` | 200, массив |
| GET | `/api/contacts/:id` | 200 / 404 |
| POST | `/api/contacts` | 201 + заголовок `Location` / 400 |
| PUT | `/api/contacts/:id` | 200, полная замена |
| PATCH | `/api/contacts/:id` | 200, частичное изменение |
| DELETE | `/api/contacts/:id` | 204 |

Поля контакта: `name` (обязательно), `mobile`, `home` (нужен хотя бы один телефон), `email`, `note`.
Готовые запросы для Postman или REST Client лежат в `examples/requests.http`.

### Деплой на Render

В репозитории есть `render.yaml`. В Render выберите New → Blueprint (или Web Service)
и укажите этот репозиторий. Build: `npm install --omit=dev`, Start: `npm start`.
Бесплатный сервис засыпает после 15 минут простоя, и первый запрос будит его около минуты.
Без `MONGODB_URI` данные хранятся в файле и после перезапуска сбрасываются к демонстрационным.
gRPC работает внутри того же процесса: сайт обращается к нему через шлюз `/rpc`.
Порт 50051 снаружи недоступен, так как Render открывает только HTTP-порт.

### Деплой (Heroku или другой PaaS)

`Procfile` готов. Порт приложение берёт из переменной `PORT`.

```sh
heroku create my-api-practicum
heroku config:set MONGODB_URI="mongodb+srv://..." MONGODB_DB=api_practicum
git push heroku main
```

На Heroku файловая система временная, поэтому данные храните в MongoDB (например, в Atlas).

## №6 — OpenAPI, ReDoc, Prism

Предметная область — магазин компьютерных игр:
`GET/POST /api/games`, `GET/PUT/DELETE /api/games/{id}`, покупка `POST /api/games/{id}/orders`
(уменьшает остаток, при нехватке товара возвращает 409). В той же спецификации описан и API контактов из №5.

Mock-сервер Prism запускается во втором терминале:

```sh
npm run mock
```

Prism работает на `http://127.0.0.1:4010` и отвечает примерами из `openapi.yaml`.
На странице раздела 06 переключите «Источник» на **Prism mock :4010**, и карточки загрузятся из мока.
Проверка в Postman: `GET http://127.0.0.1:4010/api/games`. Сравните ответ со схемой в ReDoc.
Prism проверяет и тело запроса: на неверный POST (например, без `price`) он вернёт 400, как описано в спецификации.

## №7 — GraphQL (вариант 1, библиотека)

Эндпоинт `POST /graphql`. Схема хранится в `server/graphql/schema.graphql`.

```graphql
query {
  books(genre: "Роман") {
    id
    name
    genre
    author { name }
  }
}

mutation {
  addBook(input: { name: "Война и мир", genre: "Роман", authorName: "Толстой Лев Николаевич" }) {
    id
    author { id name }
  }
}
```

Также доступны `book(id)`, `authors`, `author(id) { books { … } }`, `genres`, `updateBook`, `deleteBook`,
`addAuthor` и `deleteAuthor`. В блоке «Выбор полей» на странице можно отметить нужные поля:
запрос пересоберётся, и сервер вернёт только их. В этом главное отличие GraphQL от REST.

## №8 — gRPC (вариант 3, задачи на день)

Контракт `server/grpc/tasks.proto`, сервис `planner.TaskService`:
`ListTasks`, `GetTask`, `CreateTask`, `UpdateTask`, `DeleteTask`, `GetDayStats`.

Браузер не умеет вызывать gRPC напрямую, поэтому запросы идут так:

```text
страница → fetch /rpc/tasks → HTTP-шлюз (Express) → gRPC-клиент → TaskService :50051 → хранилище
```

В ответах шлюза есть заголовки `X-Transport: gRPC` и `X-Grpc-Method`. Сервер пишет каждый вызов в консоль.

Консольный клиент (при запущенном `npm start`) проходит весь CRUD:

```sh
npm run grpc:client
```

В Postman: New → gRPC, адрес `127.0.0.1:50051`, импортируйте `tasks.proto`.

gRPC-сервер можно запустить отдельным процессом:
`npm run grpc:server`, затем в `.env` поставить `GRPC_EXTERNAL=true` и выполнить `npm start`.

## Тесты

```sh
npm test
```

Тесты проверяют CRUD №5, API игр и заказ №6, GraphQL-запросы и мутации №7,
а также реальные gRPC-вызовы и HTTP-шлюз №8. Используется временная база.

## Структура

```text
server/
  index.js          запуск HTTP + gRPC
  app.js            маршруты Express (REST, документация, GraphQL, шлюз gRPC)
  services.js       бизнес-логика и валидация
  storage.js        JSON-файл / MongoDB
  seed.js           демонстрационные данные
  graphql/          schema.graphql + резолверы
  grpc/             tasks.proto, сервер и клиент, отдельный процесс
docs/               openapi.yaml, ReDoc, Swagger UI
public/             веб-клиент (HTML/CSS/JS без сборки), GraphiQL
scripts/            консольный gRPC-клиент
examples/           готовые HTTP-запросы
tests/              интеграционные тесты
```
