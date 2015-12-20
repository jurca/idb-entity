
import DBFactory from "../node_modules/indexed-db.es6/es2015/DBFactory"
import AbstractEntity from "../es2015/AbstractEntity"
import EntityManager from "../es2015/EntityManager"
import Transaction from "../es2015/Transaction"
import {promiseIt, delay} from "./testUtils"

describe("Entity manager", () => {

  const DB_NAME = "testingDB"
  const OBJECT_STORE_NAME = "foo"

  let database
  let databasePromise
  let entityManager

  class Entity extends AbstractEntity {
    static get objectStore() {
      return OBJECT_STORE_NAME
    }
  }

  beforeEach((done) => {
    let rawRecords = [
      {
        bar: "baz"
      },
      {
        created: new Date()
      }
    ]

    databasePromise = DBFactory.open(DB_NAME, {
      version: 1,
      objectStores: [{
        name: OBJECT_STORE_NAME,
        keyPath: "id",
        autoIncrement: true
      }]
    }).then((db) => {
      database = db
      let transaction = database.startTransaction(OBJECT_STORE_NAME)

      for (let record of rawRecords) {
        let objectStore = transaction.getObjectStore(OBJECT_STORE_NAME)
        objectStore.add(record)
      }

      return transaction.completionPromise
    }).then(() => {
      entityManager = new EntityManager(databasePromise, {
        idleTransactions: {
          ttl: 10000,
          warningDelay: 2000,
          observer: (transaction, isAborted) => {
            if (isAborted) {
              console.error("A transaction has been aborted due to being " +
                  "idle for too long")
            } else {
              console.warn("A transaction is idle for too long")
            }
          }
        }
      }, new Map([[Entity, "id"]]))

      done()
      return database
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

  promiseIt("should be able to fetch single entities", () => {
    return entityManager.find(Entity, 1).then((entity) => {
      expect(entity instanceof Entity).toBeTruthy()
      expect(Object.assign({}, entity)).toEqual({ id: 1, bar: "baz" })
    })
  })

  promiseIt("should resolve to null if fetching non-existing entities", () => {
    return entityManager.find(Entity, 10).then((entity) => {
      expect(entity).toBeNull()

      return entityManager.find(Entity, new Date(1))
    }).then((entity) => {
      expect(entity).toBeNull()
    })
  })

  promiseIt("should start a read-write transaction", () => {
    let transaction = entityManager.startTransaction()

    return transaction.persist(new Entity({
      foo: "bar"
    })).then(() => {
      return transaction.commit()
    })
  })

  promiseIt("must throw an error when starting multiple transactions", () => {
    let transaction = entityManager.startTransaction()
    expect(() => {
      entityManager.startTransaction()
    }).toThrow()

    return delay(100).then(() => {
      expect(() => {
        entityManager.startTransaction()
      }).toThrow()

      let commitPromise = transaction.commit()
      expect(() => {
        entityManager.startTransaction()
      }).toThrow()
      return commitPromise
    }).then(() => {
      return entityManager.startTransaction().commit()
    })
  })

  promiseIt("should start a long-running transaction", () => {
    let transaction = entityManager.startTransaction()
    return delay(100).then(() => {
      return transaction.persist(new Entity({}))
    }).then((entity) => {
      return delay(100).then(() => entity)
    }).then((entity) => {
      return transaction.commit().then(() => entity.id)
    }).then((id) => {
      expect(id).toBe(3)
    })
  })

  promiseIt("should run a transaction", () => {
    return entityManager.runTransaction((transaction) => {
      expect(transaction instanceof Transaction).toBeTruthy()

      return transaction.persist(new Entity({}))
    }).then((entity) => {
      expect(entity.id).toBe(3)
    })
  })

  promiseIt("should abort the ran transaction if an error is thrown", () => {
    return entityManager.runTransaction((transaction) => {
      transaction.persist(new Entity({}))
      throw new Error("testing, testing")
    }).then(() => {
      throw new Error("The transaction should have been aborted")
    }).catch((error) => {
      expect(error.message).toBe("testing, testing")
    }).then(() => {
      return entityManager.runTransaction(() => {
        return delay(100).then(() => Promise.reject(new Error("test #2")))
      })
    }).then(() => {
      throw new Error("The transaction should have been aborted")
    }).catch((error) => {
      expect(error.message).toBe("test #2")
    }).then(() => {
      return entityManager.runTransaction((transaction) => {
        return transaction.persist(new Entity({
          invalid: document.createElement("div")
        }))
      })
    }).then(() => {
      let error = new Error("The transaction should have been aborted")
      error.failed = true
      throw error
    }).catch((error) => {
      expect(error.failed).toBeFalsy()
    })
  })

})
