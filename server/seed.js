'use strict';
// Демонстрационные данные: добавляются только при первом запуске (когда база совсем пустая),
// чтобы удалённые вручную записи не появлялись снова после перезапуска.

async function seed(services, db) {
  const names = ['contacts', 'games', 'authors', 'books', 'tasks'];
  for (const name of names) if ((await db.collection(name).count()) > 0) return;

  {
    await services.contacts.create({ name: 'Иван Петров', mobile: '+7 900 111-22-33', email: 'ivan@example.com' });
    await services.contacts.create({ name: 'Мария Смирнова', mobile: '+7 916 555-44-11', home: '+7 495 123-45-67' });
  }

  {
    const list = [
      { title: 'Звёздный рубеж', genre: 'strategy', platforms: ['pc'], price: 1299, stock: 14, releaseYear: 2024, rating: 8.7, description: 'Космическая 4X-стратегия.' },
      { title: 'Тени севера', genre: 'rpg', platforms: ['pc', 'playstation', 'xbox'], price: 2999, stock: 6, releaseYear: 2025, rating: 9.1, description: 'Ролевая игра в открытом мире.' },
      { title: 'Нитро-трасса', genre: 'racing', platforms: ['playstation', 'switch'], price: 1999, stock: 0, releaseYear: 2023, rating: 7.4, description: 'Аркадные гонки.' },
      { title: 'Кубики', genre: 'puzzle', platforms: ['mobile', 'switch', 'pc'], price: 199, stock: 120, releaseYear: 2022, rating: 8.0, description: 'Головоломка на логику.' },
    ];
    for (const game of list) await services.games.create(game);
  }

  {
    const books = [
      { name: 'Мастер и Маргарита', genre: 'Роман', year: 1967, pages: 480, authorName: 'Булгаков Михаил Афанасьевич' },
      { name: 'Собачье сердце', genre: 'Повесть', year: 1987, pages: 160, authorName: 'Булгаков Михаил Афанасьевич' },
      { name: 'Преступление и наказание', genre: 'Роман', year: 1866, pages: 672, authorName: 'Достоевский Фёдор Михайлович' },
      { name: 'Пикник на обочине', genre: 'Фантастика', year: 1972, pages: 256, authorName: 'Стругацкий Аркадий Натанович' },
    ];
    for (const book of books) await services.library.addBook(book);
  }

  {
    const today = new Date().toLocaleDateString('sv-SE'); // локальная дата ГГГГ-ММ-ДД
    await services.tasks.create({ title: 'Сдать практические 5–8', date: today, time: '10:00', priority: 'HIGH' });
    await services.tasks.create({ title: 'Сделать скриншоты для отчёта', date: today, time: '12:30', priority: 'MEDIUM' });
    await services.tasks.create({ title: 'Купить продукты', date: today, priority: 'LOW' });
  }
}

module.exports = { seed };
