'use strict';
/* Веб-клиент для практических работ 5–8. Без сборки: чистый JavaScript + fetch. */

const $ = sel => document.querySelector(sel);
const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const debounce = (fn, ms = 250) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};
const localDate = (d = new Date()) => d.toLocaleDateString('sv-SE'); // ГГГГ-ММ-ДД
const money = n => `${Number(n).toLocaleString('ru-RU')} ₽`;

/* ───────────── уведомления ───────────── */
let toastTimer;
function toast(message, isError = false) {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.className = 'toast'), 3200);
}

/* ───────────── журнал запросов (для наглядности и скриншотов в отчёт) ───────────── */
const logs = {};
function addLog(section, entry) {
  (logs[section] ||= []).unshift(entry);
  logs[section].length = Math.min(logs[section].length, 12);
  renderLog(section);
}
function renderLog(section) {
  const box = document.querySelector(`[data-log="${section}"]`);
  const wasOpen = box.querySelector('details')?.open ?? false;
  const pretty = v => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  box.innerHTML = `<details ${wasOpen ? 'open' : ''}>
    <summary><span>Журнал запросов к API</span><span>${logs[section].length}</span></summary>
    <div class="log-entries">${logs[section]
      .map(
        e => `<div class="log-entry">
        <div class="log-line">
          <span class="log-method">${esc(e.method)}</span><span>${esc(e.url)}</span>
          ${e.extra ? `<span class="log-extra">${esc(e.extra)}</span>` : ''}
          <span class="log-status ${e.status >= 200 && e.status < 300 ? 'ok' : 'err'}">${e.status || 'ERR'} · ${e.ms} мс</span>
        </div>
        ${e.request !== undefined ? `<pre><b>Запрос:</b>\n${esc(pretty(e.request))}</pre>` : ''}
        ${e.response !== undefined && e.response !== '' ? `<pre><b>Ответ:</b>\n${esc(pretty(e.response))}</pre>` : ''}
      </div>`,
      )
      .join('')}</div>
  </details>`;
}

async function http(section, method, url, body, { logRequest } = {}) {
  const started = performance.now();
  let res;
  let data = '';
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : '';
    } catch {
      data = text;
    }
  } catch (error) {
    addLog(section, { method, url, status: 0, ms: Math.round(performance.now() - started), request: body, response: String(error) });
    throw new Error(url.startsWith('http://127.0.0.1:4010') ? 'Prism не запущен. Выполните npm run mock' : 'Сервер недоступен');
  }
  const grpcMethod = res.headers.get('X-Grpc-Method');
  addLog(section, {
    method,
    url,
    status: res.status,
    ms: Math.round(performance.now() - started),
    request: logRequest ?? body,
    response: data,
    extra: grpcMethod ? `gRPC → ${grpcMethod}` : '',
  });
  if (!res.ok) throw new Error(data?.error || `Ошибка ${res.status}`);
  return data;
}

/* ───────────── модальная форма ───────────── */
function openForm({ title, fields, values = {}, okText = 'Сохранить', submit }) {
  const dialog = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-error').textContent = '';
  $('#modal-ok').textContent = okText;
  $('#modal-ok').hidden = false;
  $('#modal-fields').innerHTML = fields
    .map(f => {
      const v = values[f.name] ?? f.default ?? '';
      const attrs = `name="${f.name}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
      let input;
      if (f.type === 'select') {
        input = `<select ${attrs}>${f.options.map(([val, label]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
      } else if (f.type === 'multi') {
        input = `<div class="multi">${f.options
          .map(([val, label]) => `<label><input type="checkbox" data-multi="${f.name}" value="${esc(val)}" ${(v || []).includes(val) ? 'checked' : ''}> ${esc(label)}</label>`)
          .join('')}</div>`;
      } else if (f.type === 'checkbox') {
        return `<label class="field check ${f.full ? 'full' : ''}"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
      } else if (f.type === 'textarea') {
        input = `<textarea ${attrs} rows="3">${esc(v)}</textarea>`;
      } else {
        input = `<input type="${f.type || 'text'}" ${attrs} value="${esc(v)}" ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''}>`;
      }
      return `<label class="field ${f.full ? 'full' : ''}">${esc(f.label)}${input}</label>`;
    })
    .join('');

  const form = $('#modal-form');
  form.onsubmit = async event => {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') return dialog.close();
    if (!form.reportValidity()) return;
    const out = {};
    for (const f of fields) {
      if (f.type === 'multi') {
        out[f.name] = [...form.querySelectorAll(`[data-multi="${f.name}"]:checked`)].map(i => i.value);
      } else if (f.type === 'checkbox') {
        out[f.name] = form.elements[f.name].checked;
      } else {
        const raw = form.elements[f.name].value.trim();
        if (f.type === 'number') out[f.name] = raw === '' ? undefined : Number(raw);
        else out[f.name] = raw;
      }
    }
    try {
      $('#modal-ok').disabled = true;
      await submit(out);
      dialog.close();
    } catch (error) {
      $('#modal-error').textContent = error.message;
    } finally {
      $('#modal-ok').disabled = false;
    }
  };
  dialog.showModal();
}

function openInfo(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-error').textContent = '';
  $('#modal-fields').innerHTML = `<div class="field full" style="font-weight:400;color:var(--text)">${html}</div>`;
  $('#modal-ok').hidden = true;
  $('#modal-form').onsubmit = e => {
    e.preventDefault();
    $('#modal').close();
  };
  $('#modal').showModal();
}

const withoutEmpty = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/* ═════════════ 05. Телефонный справочник — REST ═════════════ */
const contacts = {
  async load() {
    const search = $('#contact-search').value.trim();
    try {
      const rows = await http('05', 'GET', `/api/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`);
      this.render(rows);
    } catch (e) {
      toast(e.message, true);
    }
  },
  render(rows) {
    $('#contact-count').textContent = `${rows.length} ${plural(rows.length, 'контакт', 'контакта', 'контактов')}`;
    $('#contact-empty').hidden = rows.length > 0;
    $('#contact-rows').innerHTML = rows
      .map(
        c => `<tr>
        <td><div class="person"><span class="avatar">${esc(initials(c.name))}</span><span>${esc(c.name)}${c.note ? `<small>${esc(c.note)}</small>` : ''}</span></div></td>
        <td>${esc(c.mobile) || '—'}</td>
        <td>${esc(c.home) || '—'}</td>
        <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</td>
        <td><button class="link" data-edit="${c.id}">Изменить</button><button class="link danger" data-del="${c.id}" data-name="${esc(c.name)}">Удалить</button></td>
      </tr>`,
      )
      .join('');
  },
  fields: [
    { name: 'name', label: 'Имя', required: true, full: true, placeholder: 'Иван Петров' },
    { name: 'mobile', label: 'Мобильный', type: 'tel', placeholder: '+7 900 000-00-00' },
    { name: 'home', label: 'Домашний', type: 'tel', placeholder: '+7 495 000-00-00' },
    { name: 'email', label: 'Почта', type: 'email', full: true, placeholder: 'name@example.com' },
    { name: 'note', label: 'Заметка', full: true },
  ],
  create() {
    openForm({
      title: 'Новый контакт',
      fields: this.fields,
      okText: 'Создать',
      submit: async values => {
        await http('05', 'POST', '/api/contacts', values);
        toast('Контакт создан (201 Created)');
        this.load();
      },
    });
  },
  async edit(id) {
    try {
      const contact = await http('05', 'GET', `/api/contacts/${id}`);
      openForm({
        title: 'Редактирование контакта',
        fields: this.fields,
        values: contact,
        submit: async values => {
          await http('05', 'PUT', `/api/contacts/${id}`, values);
          toast('Контакт обновлён');
          this.load();
        },
      });
    } catch (e) {
      toast(e.message, true);
    }
  },
  async remove(id, name) {
    if (!confirm(`Удалить контакт «${name}»?`)) return;
    try {
      await http('05', 'DELETE', `/api/contacts/${id}`);
      toast('Контакт удалён (204 No Content)');
      this.load();
    } catch (e) {
      toast(e.message, true);
    }
  },
  init() {
    $('#contact-add').onclick = () => this.create();
    $('#contact-search').oninput = debounce(() => this.load());
    $('#contact-rows').onclick = e => {
      const t = e.target;
      if (t.dataset.edit) this.edit(t.dataset.edit);
      if (t.dataset.del) this.remove(t.dataset.del, t.dataset.name);
    };
  },
};

/* ═════════════ 06. Магазин игр — API по OpenAPI ═════════════ */
const GENRES = { action: 'Экшен', rpg: 'RPG', strategy: 'Стратегия', simulator: 'Симулятор', puzzle: 'Головоломка', racing: 'Гонки', sport: 'Спорт', indie: 'Инди' };
const PLATFORMS = { pc: 'PC', playstation: 'PlayStation', xbox: 'Xbox', switch: 'Switch', mobile: 'Mobile' };
const COVERS = {
  action: ['#e9465f', '#f08a4b'],
  rpg: ['#6c4cf0', '#b06cf0'],
  strategy: ['#1f8a70', '#53c29b'],
  simulator: ['#2b7bd6', '#5bb7f0'],
  puzzle: ['#e0a21f', '#f0c85b'],
  racing: ['#d6402b', '#8a1f3a'],
  sport: ['#1f9d6b', '#2b7bd6'],
  indie: ['#5b5bd6', '#e9465f'],
};

const games = {
  get base() {
    return $('#game-source').value;
  },
  async load() {
    const params = new URLSearchParams();
    for (const [key, sel] of [['genre', '#game-genre'], ['platform', '#game-platform'], ['search', '#game-search']]) {
      const v = $(sel).value.trim();
      if (v) params.set(key, v);
    }
    try {
      const rows = await http('06', 'GET', `${this.base}/api/games${params.size ? `?${params}` : ''}`);
      this.render(Array.isArray(rows) ? rows : []);
    } catch (e) {
      this.render([]);
      toast(e.message, true);
    }
  },
  render(rows) {
    $('#game-empty').hidden = rows.length > 0;
    $('#game-grid').innerHTML = rows
      .map(g => {
        const [c1, c2] = COVERS[g.genre] || COVERS.indie;
        return `<article class="game">
          <div class="game-cover" style="background:linear-gradient(135deg,${c1},${c2})">${esc(GENRES[g.genre] || g.genre)}</div>
          <h3>${esc(g.title)}</h3>
          <div class="tags">${(g.platforms || []).map(p => `<span class="tag">${esc(PLATFORMS[p] || p)}</span>`).join('')}
            ${g.releaseYear ? `<span class="tag">${g.releaseYear}</span>` : ''}${g.rating !== undefined ? `<span class="tag">★ ${g.rating}</span>` : ''}</div>
          <div class="game-meta"><span class="price">${money(g.price)}</span>
            <span class="stock ${g.stock > 0 ? '' : 'out'}">${g.stock > 0 ? `в наличии: ${g.stock}` : 'нет в наличии'}</span></div>
          <div class="game-actions">
            <button class="btn primary small" data-buy="${g.id}" ${g.stock > 0 ? '' : 'disabled'}>Купить</button>
            <button class="link" data-edit="${g.id}">Изменить</button>
            <button class="link danger" data-del="${g.id}" data-name="${esc(g.title)}">Удалить</button>
          </div>
        </article>`;
      })
      .join('');
  },
  fields: [
    { name: 'title', label: 'Название', required: true, full: true },
    { name: 'genre', label: 'Жанр', type: 'select', options: Object.entries(GENRES) },
    { name: 'price', label: 'Цена, ₽', type: 'number', required: true, min: 0, step: '0.01' },
    { name: 'platforms', label: 'Платформы', type: 'multi', full: true, options: Object.entries(PLATFORMS), default: ['pc'] },
    { name: 'stock', label: 'Остаток на складе', type: 'number', min: 0, default: 10 },
    { name: 'releaseYear', label: 'Год выхода', type: 'number', min: 1970 },
    { name: 'rating', label: 'Рейтинг (0–10)', type: 'number', min: 0, step: '0.1' },
    { name: 'description', label: 'Описание', type: 'textarea', full: true },
  ],
  form(title, values, send) {
    openForm({ title, fields: this.fields, values, submit: async v => send(withoutEmpty(v)) });
  },
  create() {
    this.form('Новая игра', {}, async body => {
      await http('06', 'POST', `${this.base}/api/games`, body);
      toast('Игра добавлена (201 Created)');
      this.load();
    });
  },
  async edit(id) {
    try {
      const game = await http('06', 'GET', `${this.base}/api/games/${id}`);
      this.form('Редактирование игры', game, async body => {
        await http('06', 'PUT', `${this.base}/api/games/${id}`, body);
        toast('Игра обновлена');
        this.load();
      });
    } catch (e) {
      toast(e.message, true);
    }
  },
  buy(id) {
    openForm({
      title: 'Оформление заказа',
      okText: 'Купить',
      fields: [{ name: 'quantity', label: 'Количество', type: 'number', min: 1, default: 1, required: true, full: true }],
      submit: async body => {
        const order = await http('06', 'POST', `${this.base}/api/games/${id}/orders`, body);
        toast(`Заказ оформлен: «${order.title}» × ${order.quantity} = ${money(order.total)}`);
        this.load();
      },
    });
  },
  async remove(id, name) {
    if (!confirm(`Удалить игру «${name}»?`)) return;
    try {
      await http('06', 'DELETE', `${this.base}/api/games/${id}`);
      toast('Игра удалена');
      this.load();
    } catch (e) {
      toast(e.message, true);
    }
  },
  init() {
    $('#game-genre').innerHTML += Object.entries(GENRES).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('#game-platform').innerHTML += Object.entries(PLATFORMS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('#game-add').onclick = () => this.create();
    $('#game-search').oninput = debounce(() => this.load());
    for (const sel of ['#game-genre', '#game-platform']) $(sel).onchange = () => this.load();
    $('#game-source').onchange = () => {
      toast(this.base ? 'Запросы идут в Prism mock: данные — примеры из openapi.yaml' : 'Запросы идут на основной сервер');
      this.load();
    };
    $('#game-grid').onclick = e => {
      const t = e.target;
      if (t.dataset.buy) this.buy(t.dataset.buy);
      if (t.dataset.edit) this.edit(t.dataset.edit);
      if (t.dataset.del) this.remove(t.dataset.del, t.dataset.name);
    };
  },
};

/* ═════════════ 07. Библиотека — GraphQL ═════════════ */
const BOOK_FIELDS = [
  ['name', 'name', true],
  ['genre', 'genre', true],
  ['year', 'year', true],
  ['pages', 'pages', false],
  ['available', 'available', true],
  ['author.name', 'author { name }', true],
  ['author.country', 'author { country }', false],
  ['createdAt', 'createdAt', false],
];
const SPINES = ['#5b5bd6', '#e9465f', '#1f9d6b', '#e0a21f', '#2b7bd6', '#9b6cf0', '#d6402b'];

const library = {
  genre: '',
  async gql(query, variables, label) {
    const body = { query, variables };
    const result = await http('07', 'POST', '/graphql', body, {
      logRequest: `${query.trim()}${variables && Object.keys(variables).length ? `\n\nvariables: ${JSON.stringify(variables)}` : ''}`,
    });
    if (result.errors?.length) throw new Error(result.errors[0].message);
    return result.data;
  },
  selectedFields() {
    const checked = [...document.querySelectorAll('#book-fields input:checked')].map(i => i.value);
    const plain = BOOK_FIELDS.filter(([k]) => checked.includes(k) && !k.startsWith('author.')).map(([, f]) => f);
    const authorParts = BOOK_FIELDS.filter(([k]) => checked.includes(k) && k.startsWith('author.')).map(([k]) => k.split('.')[1]);
    if (authorParts.length) plain.push(`author { ${authorParts.join(' ')} }`);
    return plain;
  },
  async load() {
    const fields = this.selectedFields();
    const query = `query Books($genre: String, $search: String) {
  books(genre: $genre, search: $search) {
    id
    ${fields.join('\n    ')}
  }
}`;
    const search = $('#book-search').value.trim();
    try {
      const data = await this.gql(query, withoutEmpty({ genre: this.genre || undefined, search: search || undefined }));
      this.renderBooks(data.books);
    } catch (e) {
      toast(e.message, true);
    }
  },
  async loadMeta() {
    try {
      const data = await this.gql(`query LibraryMeta {
  genres
  authors {
    id
    name
    country
    bookCount
  }
}`);
      this.authors = data.authors;
      $('#book-genres').innerHTML = ['', ...data.genres]
        .map(g => `<button class="chip ${g === this.genre ? 'active' : ''}" data-genre="${esc(g)}">${esc(g || 'Все жанры')}</button>`)
        .join('');
      $('#author-list').innerHTML = data.authors
        .map(a => `<li><button data-author="${a.id}">${esc(a.name)}</button><span class="count">${a.bookCount} ${plural(a.bookCount, 'книга', 'книги', 'книг')}</span></li>`)
        .join('') || '<li class="muted">Авторов нет</li>';
    } catch (e) {
      toast(e.message, true);
    }
  },
  renderBooks(books) {
    $('#book-empty').hidden = books.length > 0;
    $('#book-list').innerHTML = books
      .map((b, i) => {
        const meta = [
          b.author?.name && `<b>${esc(b.author.name)}</b>`,
          b.author?.country && esc(b.author.country),
          b.genre && esc(b.genre),
          b.year && `${b.year} г.`,
          b.pages && `${b.pages} стр.`,
        ].filter(Boolean);
        return `<div class="book">
          <div class="book-spine" style="background:${SPINES[i % SPINES.length]}"></div>
          <div>
            <h4>${b.name !== undefined ? esc(b.name) : '<span class="muted">name не запрошено</span>'}</h4>
            <div class="muted">${meta.join(' · ') || '—'}</div>
            ${b.createdAt ? `<div class="fields-dump">createdAt: ${esc(b.createdAt)}</div>` : ''}
          </div>
          <div style="text-align:right">
            ${b.available !== undefined ? `<span class="badge ${b.available ? 'ok' : 'no'}">${b.available ? 'в наличии' : 'выдана'}</span><br>` : ''}
            <button class="link" data-edit="${b.id}">Изменить</button><button class="link danger" data-del="${b.id}">Удалить</button>
          </div>
        </div>`;
      })
      .join('');
  },
  bookFields() {
    return [
      { name: 'name', label: 'Название книги', required: true, full: true },
      { name: 'genre', label: 'Жанр', required: true, placeholder: 'Роман' },
      { name: 'year', label: 'Год издания', type: 'number', min: 0 },
      { name: 'authorId', label: 'Автор', type: 'select', full: true, options: [['', '— новый автор —'], ...(this.authors || []).map(a => [a.id, a.name])] },
      { name: 'authorName', label: 'ФИО нового автора', full: true, placeholder: 'Заполните, если автора нет в списке' },
      { name: 'pages', label: 'Страниц', type: 'number', min: 1 },
      { name: 'available', label: 'В наличии', type: 'checkbox', default: true },
    ];
  },
  toInput(v) {
    const input = withoutEmpty({ ...v, authorId: v.authorId || undefined, authorName: v.authorId ? undefined : v.authorName || undefined });
    return input;
  },
  async create() {
    await this.loadMeta();
    openForm({
      title: 'Новая книга',
      okText: 'Добавить',
      fields: this.bookFields(),
      submit: async v => {
        const data = await this.gql(
          `mutation AddBook($input: BookInput!) {
  addBook(input: $input) {
    id
    name
    author { id name }
  }
}`,
          { input: this.toInput(v) },
        );
        toast(`Книга «${data.addBook.name}» добавлена`);
        this.refresh();
      },
    });
  },
  async edit(id) {
    try {
      await this.loadMeta();
      const { book } = await this.gql(
        `query Book($id: ID!) {
  book(id: $id) {
    id name genre year pages available
    author { id name }
  }
}`,
        { id },
      );
      openForm({
        title: 'Редактирование книги',
        fields: this.bookFields(),
        values: { ...book, authorId: book.author.id },
        submit: async v => {
          await this.gql(
            `mutation UpdateBook($id: ID!, $input: BookUpdateInput!) {
  updateBook(id: $id, input: $input) {
    id
    name
    available
  }
}`,
            { id, input: this.toInput(v) },
          );
          toast('Книга обновлена');
          this.refresh();
        },
      });
    } catch (e) {
      toast(e.message, true);
    }
  },
  async remove(id) {
    if (!confirm('Удалить книгу?')) return;
    try {
      await this.gql('mutation DeleteBook($id: ID!) {\n  deleteBook(id: $id)\n}', { id });
      toast('Книга удалена');
      this.refresh();
    } catch (e) {
      toast(e.message, true);
    }
  },
  async showAuthor(id) {
    try {
      const { author } = await this.gql(
        `query Author($id: ID!) {
  author(id: $id) {
    name
    country
    books { name genre year }
  }
}`,
        { id },
      );
      openInfo(
        author.name,
        `<p class="muted">Вложенный запрос: автор → его книги</p><ul>${author.books
          .map(b => `<li><b>${esc(b.name)}</b> — ${esc(b.genre)}${b.year ? `, ${b.year}` : ''}</li>`)
          .join('')}</ul>`,
      );
    } catch (e) {
      toast(e.message, true);
    }
  },
  refresh() {
    this.loadMeta();
    this.load();
  },
  init() {
    $('#book-fields').innerHTML = BOOK_FIELDS.map(
      ([k, , on]) => `<label><input type="checkbox" value="${k}" ${on ? 'checked' : ''}> ${k}</label>`,
    ).join('');
    $('#book-fields').onchange = () => this.load();
    $('#book-add').onclick = () => this.create();
    $('#book-search').oninput = debounce(() => this.load());
    $('#book-genres').onclick = e => {
      if (e.target.dataset.genre === undefined) return;
      this.genre = e.target.dataset.genre;
      document.querySelectorAll('#book-genres .chip').forEach(c => c.classList.toggle('active', c === e.target));
      this.load();
    };
    $('#author-list').onclick = e => e.target.dataset.author && this.showAuthor(e.target.dataset.author);
    $('#book-list').onclick = e => {
      if (e.target.dataset.edit) this.edit(e.target.dataset.edit);
      if (e.target.dataset.del) this.remove(e.target.dataset.del);
    };
  },
};

/* ═════════════ 08. Задачи на день — gRPC ═════════════ */
const PRIORITY = { HIGH: 'Высокий', MEDIUM: 'Средний', LOW: 'Низкий' };

const planner = {
  get date() {
    return $('#day-date').value || localDate();
  },
  async load() {
    const pending = $('#day-pending').checked;
    try {
      const [tasks, stats] = await Promise.all([
        http('08', 'GET', `/rpc/tasks?date=${this.date}${pending ? '&onlyPending=true' : ''}`),
        http('08', 'GET', `/rpc/stats?date=${this.date}`),
      ]);
      this.render(tasks, stats);
    } catch (e) {
      toast(e.message, true);
    }
  },
  render(tasks, stats) {
    $('#day-stats').textContent = `${stats.done} из ${stats.total} выполнено`;
    $('#day-progress').style.width = stats.total ? `${(stats.done / stats.total) * 100}%` : '0';
    $('#task-empty').hidden = tasks.length > 0;
    $('#task-list').innerHTML = tasks
      .map(
        t => `<li class="task ${t.done ? 'done' : ''}">
        <input type="checkbox" data-toggle="${t.id}" ${t.done ? 'checked' : ''} title="Отметить выполненной">
        <div><span class="time">${esc(t.time) || '—'}</span> <span class="task-title">${esc(t.title)}</span>${t.description ? `<small>${esc(t.description)}</small>` : ''}</div>
        <span class="prio ${t.priority}">${PRIORITY[t.priority]}</span>
        <span><button class="link" data-edit="${t.id}">Изменить</button><button class="link danger" data-del="${t.id}">Удалить</button></span>
      </li>`,
      )
      .join('');
  },
  async add(form) {
    const body = withoutEmpty({
      title: form.title.value.trim(),
      time: form.time.value || undefined,
      priority: form.priority.value,
      date: this.date,
    });
    try {
      await http('08', 'POST', '/rpc/tasks', body);
      form.reset();
      toast('Задача создана — rpc CreateTask');
      this.load();
    } catch (e) {
      toast(e.message, true);
    }
  },
  async toggle(id, done) {
    try {
      await http('08', 'PATCH', `/rpc/tasks/${id}`, { done });
      this.load();
    } catch (e) {
      toast(e.message, true);
    }
  },
  async edit(id) {
    try {
      const task = await http('08', 'GET', `/rpc/tasks/${id}`);
      openForm({
        title: 'Редактирование задачи',
        values: task,
        fields: [
          { name: 'title', label: 'Задача', required: true, full: true },
          { name: 'description', label: 'Описание', type: 'textarea', full: true },
          { name: 'date', label: 'Дата', type: 'date', required: true },
          { name: 'time', label: 'Время', type: 'time' },
          { name: 'priority', label: 'Приоритет', type: 'select', options: Object.entries(PRIORITY) },
          { name: 'done', label: 'Выполнена', type: 'checkbox' },
        ],
        submit: async v => {
          await http('08', 'PATCH', `/rpc/tasks/${id}`, v);
          toast('Задача обновлена — rpc UpdateTask');
          this.load();
        },
      });
    } catch (e) {
      toast(e.message, true);
    }
  },
  async remove(id) {
    if (!confirm('Удалить задачу?')) return;
    try {
      await http('08', 'DELETE', `/rpc/tasks/${id}`);
      toast('Задача удалена — rpc DeleteTask');
      this.load();
    } catch (e) {
      toast(e.message, true);
    }
  },
  shift(days) {
    const d = new Date(`${this.date}T12:00:00`);
    d.setDate(d.getDate() + days);
    $('#day-date').value = localDate(d);
    this.load();
  },
  init() {
    $('#day-date').value = localDate();
    $('#day-date').onchange = () => this.load();
    $('#day-prev').onclick = () => this.shift(-1);
    $('#day-next').onclick = () => this.shift(1);
    $('#day-today').onclick = () => {
      $('#day-date').value = localDate();
      this.load();
    };
    $('#day-pending').onchange = () => this.load();
    $('#task-form').onsubmit = e => {
      e.preventDefault();
      this.add(e.target);
    };
    $('#task-list').onclick = e => {
      const t = e.target;
      if (t.dataset.toggle) this.toggle(t.dataset.toggle, t.checked);
      if (t.dataset.edit) this.edit(t.dataset.edit);
      if (t.dataset.del) this.remove(t.dataset.del);
    };
  },
};

/* ───────────── утилиты и навигация ───────────── */
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function initials(name) {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

const pages = {
  '05': () => contacts.load(),
  '06': () => games.load(),
  '07': () => library.refresh(),
  '08': () => planner.load(),
};
function route() {
  const tab = pages[location.hash.slice(1)] ? location.hash.slice(1) : '05';
  document.querySelectorAll('.page').forEach(p => (p.hidden = p.dataset.page !== tab));
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  pages[tab]();
}

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const info = await res.json();
    $('#status-dot').className = 'ok';
    $('#status-text').textContent = `Сервер онлайн · ${info.storage}`;
  } catch {
    $('#status-dot').className = 'bad';
    $('#status-text').textContent = 'Сервер недоступен';
  }
}

contacts.init();
games.init();
library.init();
planner.init();
window.addEventListener('hashchange', route);
route();
checkHealth();
