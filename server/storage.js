'use strict';
/**
 * Хранилище данных для всех четырёх работ.
 *  - по умолчанию: JSON-файл (data/db.json), данные переживают перезапуск;
 *  - если задан MONGODB_URI: настоящая MongoDB (как в практической №5 методички).
 * Оба варианта дают одинаковый интерфейс коллекции: list / get / insert / update / remove.
 */
const fs = require('node:fs');
const path = require('node:path');

const COLLECTIONS = ['contacts', 'games', 'authors', 'books', 'tasks'];

class FileCollection {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }
  get rows() {
    return this.db.data[this.name];
  }
  async list(filter = {}) {
    return this.rows.filter(row => Object.entries(filter).every(([k, v]) => row[k] === v)).map(clone);
  }
  async get(id) {
    const row = this.rows.find(r => r.id === id);
    return row ? clone(row) : null;
  }
  async insert(doc) {
    this.rows.push(clone(doc));
    await this.db.save();
    return clone(doc);
  }
  async update(id, changes) {
    const row = this.rows.find(r => r.id === id);
    if (!row) return null;
    Object.assign(row, clone(changes));
    await this.db.save();
    return clone(row);
  }
  async remove(id) {
    const index = this.rows.findIndex(r => r.id === id);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    await this.db.save();
    return true;
  }
  async count() {
    return this.rows.length;
  }
}

class FileDatabase {
  constructor(file) {
    this.file = path.resolve(file);
    this.kind = 'JSON-файл';
    this.queue = Promise.resolve();
    this.data = Object.fromEntries(COLLECTIONS.map(name => [name, []]));
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const name of COLLECTIONS) if (Array.isArray(saved[name])) this.data[name] = saved[name];
    }
  }
  collection(name) {
    return new FileCollection(this, name);
  }
  // Записи выстраиваются в очередь, чтобы параллельные запросы не портили файл.
  save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.queue = this.queue.then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.promises.writeFile(tmp, snapshot);
      await fs.promises.rename(tmp, this.file);
    });
    return this.queue;
  }
  async close() {
    await this.queue;
  }
}

class MongoCollection {
  constructor(collection) {
    this.c = collection;
  }
  list(filter = {}) {
    return this.c.find(filter, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray();
  }
  get(id) {
    return this.c.findOne({ id }, { projection: { _id: 0 } });
  }
  async insert(doc) {
    await this.c.insertOne({ ...doc });
    return doc;
  }
  update(id, changes) {
    return this.c.findOneAndUpdate({ id }, { $set: changes }, { returnDocument: 'after', projection: { _id: 0 } });
  }
  async remove(id) {
    const result = await this.c.deleteOne({ id });
    return result.deletedCount === 1;
  }
  count() {
    return this.c.countDocuments();
  }
}

async function openDatabase({ mongoUri, mongoDb, file }) {
  if (!mongoUri) return new FileDatabase(file);
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(mongoDb || 'api_practicum');
  for (const name of COLLECTIONS) await db.collection(name).createIndex({ id: 1 }, { unique: true });
  return {
    kind: 'MongoDB',
    collection: name => new MongoCollection(db.collection(name)),
    close: () => client.close(),
  };
}

function clone(value) {
  return structuredClone(value);
}

module.exports = { openDatabase };
