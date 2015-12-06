
import DBFactory from "../node_modules/indexed-db.es6/es2015/DBFactory"
import AbstractEntity from "../es2015/AbstractEntity"
import EntityManager from "../es2015/EntityManager"
import WriteOperationsProvider from "../es2015/WriteOperationsProvider"

describe("WriteOperationsProvider", () => {

  const DB_NAME = "testingDB"
  const OBJECT_STORE_NAME = "foo"

  let database
  let transaction

  beforeEach((done) => {
    DBFactory.open(DB_NAME, {
      version: 1,
      objectStores: [{
        name: OBJECT_STORE_NAME,
        keyPath: "id",
        autoIncrement: true
      }]
    }).then((db) => {
      database = db
      transaction = database.startTransaction(OBJECT_STORE_NAME)
      done()
    }).catch((error) => {
      fail(error)
      done()
    })
  })

  afterEach((done) => {
    database.close().then(() => {
      return DBFactory.deleteDatabase(DB_NAME)
    }).then(() => {
      done()
    }).catch((error) => {
      fail(error)
      done()
    })
  })

  promiseIt("should persist records", () => {
    let provider = getProvider()
    return provider.persist(new Entity({
      foo: "bar"
    })).then((entity) => {
      expect(Object.assign({}, entity)).toEqual({
        id: 1,
        foo: "bar"
      })

      return transaction.completionPromise
    })
  })

  function promiseIt(behavior, test) {
    it(behavior, (done) => {
      test().then(done).catch((error) => {
        fail(error)
        done()
      })
    })
  }

  function getProvider() {
    class DummyManager extends EntityManager {
      constructor() {
        super(Promise.resolve(), {}, new Map())
      }

      containsByPrimaryKey(_, __) {
        return false
      }
    }

    return new WriteOperationsProvider(
      transaction,
      (entityClass, keyPath, data) => {
        return new entityClass(data)
      },
      new DummyManager()
    )
  }

  class Entity extends AbstractEntity {
    static get objectStore() {
      return OBJECT_STORE_NAME
    }
  }

})
