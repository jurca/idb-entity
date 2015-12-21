
import DBFactory from "../node_modules/indexed-db.es6/es2015/DBFactory"
import AbstractEntity from "../es2015/AbstractEntity"
import EntityManager from "../es2015/EntityManager"
import WriteOperationsProvider from "../es2015/WriteOperationsProvider"
import {promiseIt} from "./testUtils"

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
      transaction.getObjectStore(OBJECT_STORE_NAME).add({
        bar: "baz"
      })
      transaction.getObjectStore(OBJECT_STORE_NAME).add({
        created: new Date()
      })
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
    let entity = new Entity({
      foo: "bar"
    })
    return provider.persist(entity).then((savedEntity) => {
      expect(savedEntity).toBe(entity)
      expect(Object.assign({}, savedEntity)).toEqual({
        id: 3,
        foo: "bar"
      })
      expect(savedEntity instanceof Entity).toBeTruthy()

      return transaction.completionPromise
    })
  })

  promiseIt("should manage persisted records", () => {
    let manageCalled = 0
    return (new WriteOperationsProvider(
      transaction,
      (entityClass, keyPath, data) => {
        manageCalled++
        if (data instanceof entityClass) {
          return data
        }

        return new entityClass(data)
      },
      new (class extends EntityManager {
      })
    )).persist(new Entity({ foo: "bar" })).then(() => {
      return transaction.completionPromise
    }).then(() => {
      expect(manageCalled).toBe(1)
    })
  })

  promiseIt("should remove records", () => {
    let provider = getProvider()
    return provider.remove(Entity, 1).then(() => {
      return transaction.completionPromise
    }).then(() => {
      return database.runReadOnlyTransaction(OBJECT_STORE_NAME, (store) => {
        return store.count()
      })
    }).then((count) => {
      expect(count).toBe(1)
    })
  })

  promiseIt("should detach removed entities", () => {
    let containsCalled = 0
    let findCalled = 0
    let detachCalled = 0

    return (new WriteOperationsProvider(
      transaction,
      (entityClass, keyPath, data) => {
        if (data instanceof entityClass) {
          return data
        }

        return new entityClass(data)
      },
      new (class extends EntityManager {
        containsByPrimaryKey() {
          containsCalled++
          return true
        }

        find(entityClass, primaryKey) {
          findCalled++
          expect(entityClass).toBe(Entity)
          expect(primaryKey).toBe(1)
          return Promise.resolve({ myKey: 123987 })
        }

        detach(entity) {
          detachCalled++
          expect(entity).toEqual({ myKey: 123987 })
        }
      })
    )).remove(Entity, 1).then(() => {
      return transaction.completionPromise
    }).then(() => {
      expect(containsCalled).toBe(1)
      expect(findCalled).toBe(1)
      expect(detachCalled).toBe(1)
    })
  })

  promiseIt("should perform update queries", () => {
    let provider = getProvider()
    return provider.updateQuery(Entity, 2, "next", 0, 1, (entity) => {
      expect(entity instanceof Entity).toBeTruthy()
      entity.updated = true
    }).then(() => {
      return transaction.completionPromise
    }).then(() => {
      return database.runReadOnlyTransaction(OBJECT_STORE_NAME, (store) => {
        return store.getAll(2)
      })
    }).then((records) => {
      expect(records.every(record => record.updated)).toBeTruthy()
    }).then(() => {
      return database.runReadOnlyTransaction(OBJECT_STORE_NAME, (store) => {
        return store.getAll(1)
      })
    }).then((records) => {
      expect(records.every((record) => {
        return record.updated === undefined
      })).toBeTruthy()
    })
  })

  promiseIt("should manage entities affected by update queries", () => {
    let manageCalled = 0

    return (new WriteOperationsProvider(
      transaction,
      (entityClass, keyPath, data) => {
        manageCalled++
        if (data instanceof entityClass) {
          return data
        }

        return new entityClass(data)
      },
      new (class extends EntityManager {
      })
    )).updateQuery(Entity, null, "next", 0, null, (entity) => {
      return entity
    }).then(() => {
      return transaction.completionPromise
    }).then(() => {
      expect(manageCalled).toBe(2)
    })
  })

  promiseIt("should perform delete queries", () => {
    let provider = getProvider()
    return provider.deleteQuery(Entity, 1, "next", 0, 1).then(() => {
      return transaction.completionPromise
    }).then(() => {
      return database.runReadOnlyTransaction(OBJECT_STORE_NAME, (store) => {
        return store.count()
      })
    }).then((count) => {
      expect(count).toBe(1)
    })
  })

  promiseIt("should detach entities affected by a delete query", () => {
    let containsCalled = 0
    let findCalled = 0
    let detachCalled = 0

    return (new WriteOperationsProvider(
      transaction,
      (entityClass, keyPath, data) => {
        if (data instanceof entityClass) {
          return data
        }

        return new entityClass(data)
      },
      new (class extends EntityManager {
        containsByPrimaryKey() {
          containsCalled++
          return true
        }

        find(entityClass, primaryKey) {
          findCalled++
          expect(entityClass).toBe(Entity)
          expect(primaryKey).toBeGreaterThan(0)
          expect(primaryKey).toBeLessThan(3)
          return Promise.resolve({ myKey: 123987 })
        }

        detach(entity) {
          detachCalled++
          expect(entity).toEqual({ myKey: 123987 })
        }
      })
    )).deleteQuery(Entity, null, "next", 0, null).then(() => {
      return transaction.completionPromise
    }).then(() => {
      expect(containsCalled).toBe(2)
      expect(findCalled).toBe(2)
      expect(detachCalled).toBe(2)
    })
  })

  function getProvider() {
    return new WriteOperationsProvider(
      transaction,
      (entityClass, keyPath, data) => {
        if (data instanceof entityClass) {
          return data
        }

        return new entityClass(data)
      },
      new (class extends EntityManager {
        containsByPrimaryKey(_, __) {
          return false
        }
      })
    )
  }

  class Entity extends AbstractEntity {
    static get objectStore() {
      return OBJECT_STORE_NAME
    }
  }

})
