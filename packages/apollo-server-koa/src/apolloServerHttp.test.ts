// tslint:disable
// TODO: enable when you figure out how to automatically fix trailing commas

// TODO: maybe we should get rid of these tests entirely, and move them to expressApollo.test.ts

// TODO: wherever possible the tests should be rewritten to make them easily work with Hapi, express, Koa etc.

/*
 * Below are the HTTP tests from koa-graphql. We're using them here to make
 * sure apolloServer still works if used in the place of koa-graphql.
 */

import { graphqlKoa } from './koaApollo';

/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

import { expect } from 'chai';
import * as zlib from 'zlib';
import * as multer from 'koa-multer';
import * as bodyParser from 'koa-bodyparser';
import * as KoaRouter from 'koa-router';
const request = require('supertest');
const Koa = require('koa');
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLNonNull,
  GraphQLString,
  GraphQLScalarType,
  GraphQLError,
  BREAK,
} from 'graphql';

const QueryRootType = new GraphQLObjectType({
  name: 'QueryRoot',
  fields: {
    test: {
      type: GraphQLString,
      args: {
        who: {
          type: GraphQLString,
        },
      },
      resolve: (_, args) => 'Hello ' + (args['who'] || 'World'),
    },
    thrower: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: () => {
        throw new Error('Throws!');
      },
    },
    custom: {
      type: GraphQLString,
      args: {
        foo: {
          type: new GraphQLScalarType({
            name: 'Foo',
            serialize: v => v,
            parseValue: () => {
              throw new Error('Something bad happened');
            },
            parseLiteral: () => {
              throw new Error('Something bad happened');
            },
          }),
        },
      },
    },
    context: {
      type: GraphQLString,
      resolve: (_obj, _args, context) => context,
    },
  },
});

const TestSchema = new GraphQLSchema({
  query: QueryRootType,
  mutation: new GraphQLObjectType({
    name: 'MutationRoot',
    fields: {
      writeTest: {
        type: QueryRootType,
        resolve: () => ({}),
      },
    },
  }),
});

function catchError(p) {
  return p.then(
    res => {
      // workaround for unknown issues with testing against npm package of koa-graphql.
      // the same code works when testing against the source, I'm not sure why.
      if (res && res.error) {
        return { response: res };
      }
      throw new Error('Expected to catch error.');
    },
    error => {
      if (!(error instanceof Error)) {
        throw new Error('Expected error to be instanceof Error.');
      }
      return error;
    },
  );
}

function promiseTo(fn) {
  return new Promise((resolve, reject) => {
    fn((error, result) => (error ? reject(error) : resolve(result)));
  });
}

describe('test harness', () => {
  it('expects to catch errors', async () => {
    let caught;
    try {
      await catchError(Promise.resolve());
    } catch (error) {
      caught = error;
    }
    expect(caught && caught.message).to.equal('Expected to catch error.');
  });

  it('expects to catch actual errors', async () => {
    let caught;
    try {
      await catchError(Promise.reject('not a real error'));
    } catch (error) {
      caught = error;
    }
    expect(caught && caught.message).to.equal(
      'Expected error to be instanceof Error.',
    );
  });

  it('resolves callback promises', async () => {
    const resolveValue = {};
    const result = await promiseTo(cb => cb(null, resolveValue));
    expect(result).to.equal(resolveValue);
  });

  it('rejects callback promises with errors', async () => {
    const rejectError = new Error();
    let caught;
    try {
      await promiseTo(cb => cb(rejectError));
    } catch (error) {
      caught = error;
    }
    expect(caught).to.equal(rejectError);
  });
});

describe(`GraphQL-HTTP (apolloServer) tests for koa`, () => {
  describe('POST functionality', () => {
    it('allows gzipped POST bodies', async () => {
      const app = new Koa();
      const router = new KoaRouter();

      router.use('/graphql', bodyParser());
      router.all(
        '/graphql',
        graphqlKoa(() => ({
          schema: TestSchema,
        })),
      );

      app.use(router.routes());

      const data = { query: '{ test(who: "World") }' };
      const json = JSON.stringify(data);
      // TODO had to write "as any as Buffer" to make tsc accept it. Does it matter?
      const gzippedJson = await promiseTo(cb =>
        zlib.gzip((json as any) as Buffer, cb),
      );

      const req = request(app.callback())
        .post('/graphql')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip');
      req.write(gzippedJson);
      const response = await req;

      expect(JSON.parse(response.text)).to.deep.equal({
        data: {
          test: 'Hello World',
        },
      });
    });

    it('allows deflated POST bodies', async () => {
      const app = new Koa();
      const router = new KoaRouter();

      router.use('/graphql', bodyParser());
      router.all(
        '/graphql',
        graphqlKoa(() => ({
          schema: TestSchema,
        })),
      );

      app.use(router.routes());

      const data = { query: '{ test(who: "World") }' };
      const json = JSON.stringify(data);
      // TODO had to write "as any as Buffer" to make tsc accept it. Does it matter?
      const deflatedJson = await promiseTo(cb =>
        zlib.deflate((json as any) as Buffer, cb),
      );

      const req = request(app.callback())
        .post('/graphql')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'deflate');
      req.write(deflatedJson);
      const response = await req;

      expect(JSON.parse(response.text)).to.deep.equal({
        data: {
          test: 'Hello World',
        },
      });
    });

    it('allows for pre-parsed POST bodies', () => {
      // Note: this is not the only way to handle file uploads with GraphQL,
      // but it is terse and illustrative of using koa-graphql and multer
      // together.

      // A simple schema which includes a mutation.
      const UploadedFileType = new GraphQLObjectType({
        name: 'UploadedFile',
        fields: {
          originalname: { type: GraphQLString },
          mimetype: { type: GraphQLString },
        },
      });

      const TestMutationSchema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: 'QueryRoot',
          fields: {
            test: { type: GraphQLString },
          },
        }),
        mutation: new GraphQLObjectType({
          name: 'MutationRoot',
          fields: {
            uploadFile: {
              type: UploadedFileType,
              resolve(rootValue) {
                // For this test demo, we're just returning the uploaded
                // file directly, but presumably you might return a Promise
                // to go store the file somewhere first.
                return rootValue.request.file;
              },
            },
          },
        }),
      });

      const app = new Koa();
      const router = new KoaRouter();

      // Multer provides multipart form data parsing.
      const storage = multer.memoryStorage();
      router.use('/graphql', multer({ storage }).single('file'));

      // Providing the request as part of `rootValue` allows it to
      // be accessible from within Schema resolve functions.
      router.all(
        '/graphql',
        graphqlKoa(ctx => {
          return {
            schema: TestMutationSchema,
            rootValue: { request: ctx.req },
          };
        }),
      );

      app.use(router.routes());

      const req = request(app.callback())
        .post('/graphql')
        .field(
          'query',
          `mutation TestMutation {
          uploadFile { originalname, mimetype }
        }`,
        )
        .attach('file', __filename);

      return req.then(response => {
        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            uploadFile: {
              originalname: 'apolloServerHttp.test.js',
              mimetype: 'application/javascript',
            },
          },
        });
      });
    });
  });

  describe('Error handling functionality', () => {
    it('handles field errors caught by GraphQL', async () => {
      const app = new Koa();
      const router = new KoaRouter();

      router.use('/graphql', bodyParser());
      router.all(
        '/graphql',
        graphqlKoa({
          schema: TestSchema,
        }),
      );

      app.use(router.routes());

      const response = await request(app.callback())
        .post('/graphql')
        .send({
          query: '{thrower}',
        });

      expect(response.status).to.equal(200);
      expect(JSON.parse(response.text)).to.deep.equal({
        data: null,
        errors: [
          {
            extensions: {
              code: 'INTERNAL_SERVER_ERROR',
            },
            message: 'Throws!',
            locations: [{ line: 1, column: 2 }],
            path: ['thrower'],
          },
        ],
      });
    });

    it('handles type validation', async () => {
      const app = new Koa();
      const router = new KoaRouter();

      router.use('/graphql', bodyParser());
      router.all(
        '/graphql',
        graphqlKoa({
          schema: TestSchema,
        }),
      );

      app.use(router.routes());

      const response = await request(app.callback())
        .post('/graphql')
        .send({
          query: '{notExists}',
        });

      expect(response.status).to.equal(400);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [
          {
            extensions: {
              code: 'GRAPHQL_VALIDATION_FAILED',
            },
            message: 'Cannot query field "notExists" on type "QueryRoot".',
            locations: [{ line: 1, column: 2 }],
          },
        ],
      });
    });

    it('handles type validation (GET)', async () => {
      const app = new Koa();
      const router = new KoaRouter();

      router.all(
        '/graphql',
        graphqlKoa({
          schema: TestSchema,
        }),
      );

      app.use(router.routes());

      const response = await request(app.callback())
        .get('/graphql')
        .query({ query: '{notExists}' });

      expect(response.status).to.equal(400);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [
          {
            extensions: {
              code: 'GRAPHQL_VALIDATION_FAILED',
            },
            message: 'Cannot query field "notExists" on type "QueryRoot".',
            locations: [{ line: 1, column: 2 }],
          },
        ],
      });
    });

    it('handles errors thrown during custom graphql type handling', async () => {
      const app = new Koa();
      const router = new KoaRouter();

      router.use('/graphql', bodyParser());
      router.all(
        '/graphql',
        graphqlKoa({
          schema: TestSchema,
        }),
      );

      app.use(router.routes());

      const response = await request(app.callback())
        .post('/graphql')
        .send({
          query: '{custom(foo: 123)}',
        });

      expect(response.status).to.equal(400);
    });

    it('handles unsupported HTTP methods', async () => {
      const app = new Koa();
      const router = new KoaRouter();

      router.use('/graphql', bodyParser());
      router.all('/graphql', graphqlKoa({ schema: TestSchema }));

      app.use(router.routes());

      const response = await request(app.callback())
        .put('/graphql')
        .query({ query: '{test}' });

      expect(response.status).to.equal(405);
      expect(response.headers.allow).to.equal('GET, POST');
      expect(response.text).to.contain(
        'Apollo Server supports only GET/POST requests.',
      );
    });
  });

  describe('Custom validation rules', () => {
    const AlwaysInvalidRule = function(context) {
      return {
        enter() {
          context.reportError(
            new GraphQLError('AlwaysInvalidRule was really invalid!'),
          );
          return BREAK;
        },
      };
    };

    it('Do not execute a query if it do not pass the custom validation.', async () => {
      const app = new Koa();
      const router = new KoaRouter();

      router.use('/graphql', bodyParser());
      router.all(
        '/graphql',
        graphqlKoa({
          schema: TestSchema,
          validationRules: [AlwaysInvalidRule],
        }),
      );

      app.use(router.routes());

      const response = await request(app.callback())
        .post('/graphql')
        .send({
          query: '{thrower}',
        });

      expect(response.status).to.equal(400);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [
          {
            extensions: {
              code: 'GRAPHQL_VALIDATION_FAILED',
            },
            message: 'AlwaysInvalidRule was really invalid!',
          },
        ],
      });
    });
  });
});
