'use strict';
/**
 * №7. GraphQL-сервер: схема описана на SDL (schema.graphql),
 * резолверы подключаются к полям схемы ниже. Эндпоинт — POST /graphql.
 */
const fs = require('node:fs');
const path = require('node:path');
const { buildSchema, graphql, GraphQLError } = require('graphql');
const { AppError } = require('../services');

const SDL_PATH = path.join(__dirname, 'schema.graphql');
const sdl = fs.readFileSync(SDL_PATH, 'utf8');

function createSchema(library) {
  const schema = buildSchema(sdl);
  const resolvers = {
    Query: {
      books: (_, args) => library.books(args),
      book: (_, { id }) => library.findBook(id),
      authors: () => library.authors(),
      author: (_, { id }) => library.findAuthor(id),
      genres: () => library.genres(),
    },
    Mutation: {
      addBook: (_, { input }) => library.addBook(input),
      updateBook: (_, { id, input }) => library.updateBook(id, input),
      deleteBook: (_, { id }) => library.deleteBook(id),
      addAuthor: (_, args) => library.addAuthor(args),
      deleteAuthor: (_, { id }) => library.deleteAuthor(id),
    },
    Book: {
      author: book => library.getAuthor(book.authorId),
    },
    Author: {
      books: author => library.books({ authorId: author.id }),
      bookCount: async author => (await library.books({ authorId: author.id })).length,
    },
  };
  for (const [typeName, fields] of Object.entries(resolvers)) {
    const typeFields = schema.getType(typeName).getFields();
    for (const [field, resolve] of Object.entries(fields)) typeFields[field].resolve = resolve;
  }
  return schema;
}

function graphqlHandler(library) {
  const schema = createSchema(library);
  return async (req, res) => {
    const { query, variables, operationName } = req.body || {};
    if (typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ errors: [{ message: 'В теле запроса нужно поле query' }] });
    }
    const result = await graphql({ schema, source: query, variableValues: variables, operationName });
    if (result.errors) {
      result.errors = result.errors.map(err => {
        const original = err.originalError;
        // Ошибки валидации отдаём клиенту как есть, внутренние — скрываем.
        if (original && !(original instanceof AppError) && !(original instanceof GraphQLError)) {
          console.error(original);
          return { message: 'Внутренняя ошибка сервера', path: err.path };
        }
        return err.toJSON();
      });
    }
    res.json(result);
  };
}

module.exports = { graphqlHandler, SDL_PATH };
