'use strict';
/**
 * Бизнес-логика (валидация + работа с хранилищем). Её используют все транспорты:
 * REST (№5, №6), GraphQL (№7) и gRPC-сервер (№8).
 */
const { randomUUID } = require('node:crypto');

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const notFound = message => new AppError(message, 404);

function str(input, key, { required = false, max = 200, label = key } = {}) {
  const value = input[key];
  if (value === undefined || value === null) {
    if (required) throw new AppError(`Поле «${label}» обязательно`);
    return undefined;
  }
  if (typeof value !== 'string') throw new AppError(`Поле «${label}» должно быть строкой`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new AppError(`Поле «${label}» обязательно`);
  if (trimmed.length > max) throw new AppError(`Поле «${label}» длиннее ${max} символов`);
  return trimmed;
}

function int(input, key, { required = false, min = 0, max = 1e9, label = key } = {}) {
  const value = input[key];
  if (value === undefined || value === null) {
    if (required) throw new AppError(`Поле «${label}» обязательно`);
    return undefined;
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AppError(`Поле «${label}»: целое число от ${min} до ${max}`);
  }
  return value;
}

function num(input, key, { required = false, min = 0, max = 1e9, label = key } = {}) {
  const value = input[key];
  if (value === undefined || value === null) {
    if (required) throw new AppError(`Поле «${label}» обязательно`);
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new AppError(`Поле «${label}»: число от ${min} до ${max}`);
  }
  return Math.round(value * 100) / 100;
}

function bool(input, key, { label = key } = {}) {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new AppError(`Поле «${label}» должно быть true/false`);
  return value;
}

function oneOf(input, key, allowed, { required = false, label = key } = {}) {
  const value = str(input, key, { required, label });
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) throw new AppError(`Поле «${label}»: одно из ${allowed.join(', ')}`);
  return value;
}

function onlyKeys(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Ожидается JSON-объект');
  const extra = Object.keys(input).filter(key => !allowed.includes(key));
  if (extra.length) throw new AppError(`Неизвестные поля: ${extra.join(', ')}`);
}

const defined = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
const now = () => new Date().toISOString();

/* ───────────── №5. Телефонный справочник ───────────── */
const PHONE = /^\+?[\d\s()-]{5,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function contactsService(col) {
  function parse(input, partial) {
    onlyKeys(input, ['name', 'email', 'mobile', 'home', 'note']);
    const data = defined({
      name: str(input, 'name', { required: !partial, max: 100, label: 'Имя' }),
      email: str(input, 'email', { max: 100, label: 'Почта' }),
      mobile: str(input, 'mobile', { max: 20, label: 'Мобильный' }),
      home: str(input, 'home', { max: 20, label: 'Домашний' }),
      note: str(input, 'note', { max: 300, label: 'Заметка' }),
    });
    if (data.email && !EMAIL.test(data.email)) throw new AppError('Некорректный адрес почты');
    for (const key of ['mobile', 'home']) {
      if (data[key] && !PHONE.test(data[key])) throw new AppError(`Некорректный номер телефона: ${data[key]}`);
    }
    return data;
  }
  async function get(id) {
    const row = await col.get(id);
    if (!row) throw notFound('Контакт не найден');
    return row;
  }
  return {
    async list(search) {
      const rows = await col.list();
      if (!search) return rows;
      const q = search.toLowerCase();
      return rows.filter(c => [c.name, c.email, c.mobile, c.home].some(v => v && v.toLowerCase().includes(q)));
    },
    get,
    async create(input) {
      const data = parse(input, false);
      if (!data.mobile && !data.home) throw new AppError('Укажите хотя бы один телефон');
      return col.insert({ id: randomUUID(), email: '', mobile: '', home: '', note: '', ...data, createdAt: now() });
    },
    async update(id, input, partial) {
      const current = await get(id);
      const data = parse(input, partial);
      const next = partial ? { ...current, ...data } : { email: '', mobile: '', home: '', note: '', ...data };
      if (!next.mobile && !next.home) throw new AppError('Укажите хотя бы один телефон');
      return col.update(id, { ...next, id, createdAt: current.createdAt, updatedAt: now() });
    },
    async remove(id) {
      if (!(await col.remove(id))) throw notFound('Контакт не найден');
    },
  };
}

/* ───────────── №6. Магазин компьютерных игр (API по OpenAPI) ───────────── */
const GENRES = ['action', 'rpg', 'strategy', 'simulator', 'puzzle', 'racing', 'sport', 'indie'];
const PLATFORMS = ['pc', 'playstation', 'xbox', 'switch', 'mobile'];

function gamesService(col) {
  function parse(input, partial) {
    onlyKeys(input, ['title', 'genre', 'platforms', 'price', 'stock', 'releaseYear', 'rating', 'description']);
    const data = defined({
      title: str(input, 'title', { required: !partial, max: 120, label: 'Название' }),
      genre: oneOf(input, 'genre', GENRES, { required: !partial, label: 'Жанр' }),
      price: num(input, 'price', { required: !partial, min: 0, max: 100000, label: 'Цена' }),
      stock: int(input, 'stock', { min: 0, max: 100000, label: 'Остаток' }),
      releaseYear: int(input, 'releaseYear', { min: 1970, max: 2100, label: 'Год выхода' }),
      rating: num(input, 'rating', { min: 0, max: 10, label: 'Рейтинг' }),
      description: str(input, 'description', { max: 1000, label: 'Описание' }),
    });
    if (input.platforms !== undefined) {
      if (!Array.isArray(input.platforms) || !input.platforms.length || input.platforms.some(p => !PLATFORMS.includes(p))) {
        throw new AppError(`Платформы: непустой массив из ${PLATFORMS.join(', ')}`);
      }
      data.platforms = [...new Set(input.platforms)];
    } else if (!partial) {
      throw new AppError('Поле «Платформы» обязательно');
    }
    return data;
  }
  async function get(id) {
    const row = await col.get(id);
    if (!row) throw notFound('Игра не найдена');
    return row;
  }
  return {
    GENRES,
    PLATFORMS,
    async list({ genre, platform, maxPrice, search } = {}) {
      let rows = await col.list();
      if (genre) rows = rows.filter(g => g.genre === genre);
      if (platform) rows = rows.filter(g => g.platforms.includes(platform));
      if (maxPrice !== undefined) rows = rows.filter(g => g.price <= maxPrice);
      if (search) rows = rows.filter(g => g.title.toLowerCase().includes(search.toLowerCase()));
      return rows;
    },
    get,
    create(input) {
      const data = parse(input, false);
      return col.insert({ id: randomUUID(), stock: 0, description: '', ...data, createdAt: now() });
    },
    async update(id, input) {
      const current = await get(id);
      const data = parse(input, false);
      return col.update(id, { stock: 0, description: '', ...data, id, createdAt: current.createdAt });
    },
    async remove(id) {
      if (!(await col.remove(id))) throw notFound('Игра не найдена');
    },
    async buy(id, input) {
      onlyKeys(input || {}, ['quantity']);
      const quantity = int(input || {}, 'quantity', { required: true, min: 1, max: 100, label: 'Количество' });
      const game = await get(id);
      if (game.stock < quantity) throw new AppError(`На складе только ${game.stock} шт.`, 409);
      const updated = await col.update(id, { stock: game.stock - quantity });
      return { orderId: randomUUID(), gameId: id, title: game.title, quantity, total: Math.round(game.price * quantity * 100) / 100, stockLeft: updated.stock };
    },
  };
}

/* ───────────── №7. Библиотека книг (вариант 1, GraphQL) ───────────── */
function libraryService(authors, books) {
  async function getAuthor(id) {
    const row = await authors.get(id);
    if (!row) throw notFound('Автор не найден');
    return row;
  }
  async function getBook(id) {
    const row = await books.get(id);
    if (!row) throw notFound('Книга не найдена');
    return row;
  }
  // Автора можно указать по id или по ФИО — в этом случае он будет найден или создан.
  async function resolveAuthorId(input) {
    if (input.authorId) return (await getAuthor(input.authorId)).id;
    const name = str(input, 'authorName', { max: 120, label: 'ФИО автора' });
    if (!name) throw new AppError('Укажите автора (authorId или authorName)');
    const existing = (await authors.list()).find(a => a.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    return (await authors.insert({ id: randomUUID(), name, country: '', createdAt: now() })).id;
  }
  function parseBook(input, partial) {
    return defined({
      name: str(input, 'name', { required: !partial, max: 200, label: 'Название' }),
      genre: str(input, 'genre', { required: !partial, max: 60, label: 'Жанр' }),
      year: int(input, 'year', { min: 0, max: 2100, label: 'Год' }),
      pages: int(input, 'pages', { min: 1, max: 100000, label: 'Страниц' }),
      available: bool(input, 'available'),
    });
  }
  return {
    async books({ genre, authorId, search } = {}) {
      let rows = await books.list();
      if (genre) rows = rows.filter(b => b.genre.toLowerCase() === genre.toLowerCase());
      if (authorId) rows = rows.filter(b => b.authorId === authorId);
      if (search) rows = rows.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));
      return rows;
    },
    getBook,
    async findBook(id) {
      return books.get(id);
    },
    authors: () => authors.list(),
    getAuthor,
    async findAuthor(id) {
      return authors.get(id);
    },
    async genres() {
      return [...new Set((await books.list()).map(b => b.genre))].sort();
    },
    async addAuthor(input) {
      const name = str(input, 'name', { required: true, max: 120, label: 'ФИО автора' });
      const country = str(input, 'country', { max: 60, label: 'Страна' }) || '';
      return authors.insert({ id: randomUUID(), name, country, createdAt: now() });
    },
    async addBook(input) {
      const data = parseBook(input, false);
      const authorId = await resolveAuthorId(input);
      return books.insert({ id: randomUUID(), available: true, ...data, authorId, createdAt: now() });
    },
    async updateBook(id, input) {
      await getBook(id);
      const data = parseBook(input, true);
      if (input.authorId || input.authorName) data.authorId = await resolveAuthorId(input);
      return books.update(id, data);
    },
    async deleteBook(id) {
      return books.remove(id);
    },
    async deleteAuthor(id) {
      if ((await books.list({ authorId: id })).length) throw new AppError('Нельзя удалить автора, у которого есть книги', 409);
      return authors.remove(id);
    },
  };
}

/* ───────────── №8. Задачи на день (вариант 3, gRPC) ───────────── */
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function tasksService(col) {
  function parse(input, partial) {
    const data = defined({
      title: str(input, 'title', { required: !partial, max: 150, label: 'Задача' }),
      description: str(input, 'description', { max: 1000, label: 'Описание' }),
      date: str(input, 'date', { required: !partial, label: 'Дата' }),
      time: str(input, 'time', { label: 'Время' }),
      priority: oneOf(input, 'priority', PRIORITIES, { label: 'Приоритет' }),
      done: bool(input, 'done'),
    });
    if (data.date && !DATE.test(data.date)) throw new AppError('Дата в формате ГГГГ-ММ-ДД');
    if (data.time && !/^\d{2}:\d{2}$/.test(data.time)) throw new AppError('Время в формате ЧЧ:ММ');
    return data;
  }
  async function get(id) {
    const row = await col.get(id);
    if (!row) throw notFound('Задача не найдена');
    return row;
  }
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return {
    async list({ date, onlyPending } = {}) {
      let rows = await col.list();
      if (date) rows = rows.filter(t => t.date === date);
      if (onlyPending) rows = rows.filter(t => !t.done);
      return rows.sort((a, b) => Number(a.done) - Number(b.done) || (a.time || '99').localeCompare(b.time || '99') || order[a.priority] - order[b.priority]);
    },
    get,
    create(input) {
      const data = parse(input, false);
      return col.insert({ id: randomUUID(), description: '', time: '', priority: 'MEDIUM', done: false, ...data, createdAt: now() });
    },
    async update(id, input) {
      await get(id);
      const data = parse(input, true);
      return col.update(id, { ...data, updatedAt: now() });
    },
    async remove(id) {
      if (!(await col.remove(id))) throw notFound('Задача не найдена');
    },
    async stats(date) {
      const rows = await this.list({ date });
      return { total: rows.length, done: rows.filter(t => t.done).length };
    },
  };
}

function createServices(db) {
  return {
    contacts: contactsService(db.collection('contacts')),
    games: gamesService(db.collection('games')),
    library: libraryService(db.collection('authors'), db.collection('books')),
    tasks: tasksService(db.collection('tasks')),
  };
}

module.exports = { createServices, AppError, PRIORITIES, GENRES, PLATFORMS };
