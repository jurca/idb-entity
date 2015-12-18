
import DBFactory from "../node_modules/indexed-db.es6/es2015/DBFactory"
import AbstractEntity from "../es2015/AbstractEntity"
import EntityManager from "../es2015/EntityManager"
import Transaction from "../es2015/Transaction"
import TransactionRunner from "../es2015/TransactionRunner"
import {serializeKey, equals} from "../es2015/utils"
import {promiseIt, delay} from "./testUtils"

describe("Transaction", () => {

  const DB_NAME = "testingDB"
  const OBJECT_STORE_NAME = "foo"

  let database
  let idbEs6Transaction
  let containsByPrimaryKey
  let completionCalled
  let transaction
  let rawRecords
  let entities
  let detachedEntities

  class Entity extends AbstractEntity {
    static get objectStore() {
      return OBJECT_STORE_NAME
    }
  }

  beforeEach((done) => {
    containsByPrimaryKey = false
    completionCalled = false
    detachedEntities = []

    rawRecords = [
      {
        bar: "baz"
      },
      {
        created: new Date()
      }
    ]
    entities = new Map()
    entities.set(Entity, new Map())

    DBFactory.open(DB_NAME, {
      version: 1,
      objectStores: [{
        name: OBJECT_STORE_NAME,
        keyPath: "id",
        autoIncrement: true
      }]
    }).then((db) => {
      database = db
      idbEs6Transaction = database.startTransaction(OBJECT_STORE_NAME)

      for (let record of rawRecords) {
        let objectStore = idbEs6Transaction.getObjectStore(OBJECT_STORE_NAME)
        objectStore.add(record).then((id) => {
          record.id = id
          entities.get(Entity).set(serializeKey(id), {
            data: record,
            entity: new Entity(record)
          })

          if (record === rawRecords.slice().pop()) {
            done()
          }
        })
      }

      transaction = getTransaction()
    }).catch((error) => {
      fail(error)
      done()
    })
  })

  afterEach((done) => {
    database.close().then(() => {
      return DBFactory.deleteDatabase(DB_NAME)
    }).then(() => {
      expect(completionCalled).toBeTruthy()
      done()
    }).catch((error) => {
      fail(error)
      done()
    })
  })

  promiseIt("should be alive until manually committed", () => {
    return delay(200).then(() => {
      return transaction.commit()
    })
  })

  promiseIt("must not be committable once committed", () => {
    let finishPromise = transaction.commit()
    expect(() => {
      transaction.commit()
    }).toThrow()
    return finishPromise
  })

  promiseIt("must save the modified entities", () => {
    // "unmodified" entity
    let entityMap = entities.get(Entity)
    entityMap.get(serializeKey(rawRecords[0].id)).data.marked = 1
    entityMap.get(serializeKey(rawRecords[0].id)).entity.marked = 1

    // modified entity
    let entityAndData = entityMap.get(serializeKey(rawRecords[1].id))
    entityAndData.entity.marked = 1
    delete entityAndData.entity.created

    return transaction.commit().then(() => {
      return database.runReadOnlyTransaction(OBJECT_STORE_NAME, (store) => {
        return store.count({ marked: 1 })
      })
    }).then((count) => {
      expect(count).toBe(1)
      expect(equals(entityAndData.data, entityAndData.entity)).toBeTruthy()
    })
  })

  promiseIt("must invoke the completion callback after commit", () => {
    let commitPromise = transaction.commit()
    expect(completionCalled).toBeFalsy()
    return commitPromise.then(() => {
      expect(completionCalled).toBeTruthy()
    })
  })

  promiseIt("must be aborted with an AbortError", () => {
    return transaction.abort().then(() => {
      throw new Error("An AbortError should have been thrown")
    }).catch((error) => {
      expect(error.name).toBe("AbortError")
    })
  })

  promiseIt("must not be committable after aborting", () => {
    let abortPromise = transaction.abort()
    expect(() => {
      transaction.commit()
    }).toThrow()
    return abortPromise.catch((error) => {
      expect(error.name).toBe("AbortError")
    })
  })

  promiseIt("should revert entity modifications after aborting", () => {
    let id = rawRecords[0].id
    let entityAndData = entities.get(Entity).get(serializeKey(id))
    entityAndData.entity.created = "yes"
    entityAndData.entity.marked = 1
    delete entityAndData.data.bar

    return transaction.abort().catch(() => {}).then(() => {
      expect(entityAndData.data.marked).toBeUndefined()
      expect(equals(entityAndData.data, entityAndData.entity)).toBeTruthy()
    })
  })

  promiseIt("must invoke the completion callback after abort", () => {
    let abortPromise = transaction.abort()
    expect(completionCalled).toBeFalsy()
    return abortPromise.catch(() => {
      expect(completionCalled).toBeTruthy()
    })
  })

  promiseIt("should persist new entities", () => {
    return transaction.persist(new Entity({
      foo: {
        bar: "baz"
      }
    })).then((entity) => {
      expect(Object.assign({}, entity)).toEqual({
        id: 3,
        foo: {
          bar: "baz"
        }
      })
      return transaction.commit()
    })
  })

  promiseIt("must not allow persisting entities after committing", () => {
    let commitPromise = transaction.commit()
    expect(() => {
      transaction.persist(new Entity({ stuff: 1 }))
    }).toThrow()
    return commitPromise
  })

  promiseIt("should delete existing entities", () => {
    return transaction.remove(Entity, 1).then(() => {
      return transaction.commit()
    }).then(() => {
      return database.runReadOnlyTransaction(OBJECT_STORE_NAME, (store) => {
        return store.count()
      })
    }).then((count) => {
      expect(count).toBe(1)
    })
  })

  promiseIt("must not allow deleting entities after committing", () => {
    let commitPromise = transaction.commit()
    expect(() => {
      transaction.remove(Entity, 1)
    }).toThrow()
    return commitPromise
  })

  promiseIt("should perform update queries", () => {
    let entitiesAndData = entities.get(Entity)
    return transaction.persist(new Entity({
      skip: true
    })).then(() => {
      return transaction.updateQuery(
        Entity,
        record => !record.skip
      )((entity) => {
        expect(entity instanceof Entity).toBeTruthy()
        expect(entity.skip).toBeUndefined()
        entity.updated = 1
        let serializedId = serializeKey(entity.id)
        expect(entity).toBe(entitiesAndData.get(serializedId).entity)
      })
    }).then((updatedCount) => {
      expect(updatedCount).toBe(2)
      return transaction.commit()
    }).then(() => {
      return database.runReadOnlyTransaction(OBJECT_STORE_NAME, (store) => {
        return store.count({
          updated: 1
        })
      })
    }).then((count) => {
      expect(count).toBe(2)
    })
  })

  promiseIt("must not allow running update queries on inactive transactions",
      () => {
    let queryFactory = transaction.updateQuery(Entity)
    let commitPromise = transaction.commit()
    expect(() => {
      transaction.updateQuery(Entity)
    }).toThrow()
    expect(() => {
      queryFactory(() => {})
    }).toThrow()
    return commitPromise
  })

  promiseIt("should perform delete queries", () => {
    containsByPrimaryKey = true
    return transaction.deleteQuery(
      Entity,
      null,
      "prev",
      0,
      1
    ).then((count) => {
      expect(count).toBe(1)
      expect(detachedEntities.length).toBe(1)
      expect(detachedEntities[0] instanceof Entity).toBeTruthy()
      expect(detachedEntities[0].id).toBe(2)
      return transaction.commit()
    }).then(() => {
      return database.runReadOnlyTransaction(OBJECT_STORE_NAME, (store) => {
        return store.count()
      })
    }).then((count) => {
      expect(count).toBe(1)
    })
  })

  promiseIt("must not allow running delete queries on inactive transactions",
      () => {
    let commitPromise = transaction.commit()
    expect(() => {
      transaction.deleteQuery(Entity)
    }).toThrow()
    return commitPromise
  })

  function getTransaction() {
    let mockTransaction = {}
    let runner = new TransactionRunner(
      idbEs6Transaction,
      OBJECT_STORE_NAME,
      mockTransaction,
      {
        ttl: 3000,
        warningDelay: 1000,
        observer: (transaction, isAborted) => {
          expect(transaction).toBe(mockTransaction)
          if (isAborted) {
            console.error("A transaction has been aborted due to being idle " +
              "for too long")
          } else {
            console.warn("A transaction is idle for too long")
          }
        }
      }
    )

    return new Transaction(
      new (class extends EntityManager {
        containsByPrimaryKey(_, __) {
          return containsByPrimaryKey
        }

        detach(entity) {
          detachedEntities.push(entity)
        }

        find(_, key) {
          return entities.get(Entity).get(serializeKey(key)).entity
        }
      }),
      Promise.resolve(runner),
      entities,
      (entityClass, keyPath, data) => {
        if (data instanceof entityClass) {
          return data
        }

        let entitiesAndData = entities.get(Entity)
        let key = serializeKey(data.id)
        if (entitiesAndData.has(key)) {
          return entitiesAndData.get(key).entity
        }

        return new entityClass(data)
      },
      () => {
        completionCalled = true
      }
    )
  }

})
