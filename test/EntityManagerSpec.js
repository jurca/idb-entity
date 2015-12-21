
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
      }, new Map([[OBJECT_STORE_NAME, "id"]]))

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

  promiseIt("should not contain entities retrieved outside a transaction",
      () => {
    return entityManager.find(Entity, 1).then((entity) => {
      expect(entityManager.contains(entity)).toBeFalsy()
      expect(entityManager.containsByPrimaryKey(Entity, 1)).toBeFalsy()
    })
  })

  promiseIt("should contain entities retrieved within a transaction", () => {
    return entityManager.runTransaction(() => {
      return entityManager.find(Entity, 1).then((entity) => {
        expect(entityManager.contains(entity)).toBeTruthy()
        expect(entityManager.containsByPrimaryKey(Entity, 1)).toBeTruthy()
        return entity
      })
    }).then((entity) => {
      expect(entityManager.contains(entity)).toBeFalsy()
      expect(entityManager.containsByPrimaryKey(Entity, 1)).toBeFalsy()
    })
  })

  promiseIt("should not contain entities after transaction completes", () => {
    return entityManager.runTransaction(() => {
      return entityManager.find(Entity, 1)
    }).then((entity) => {
      expect(entityManager.contains(entity)).toBeFalsy()
    })
  })

  promiseIt("should resolve find() to distinct instances outside " +
      "transaction", () => {
    return entityManager.find(Entity, 1).then((entity) => {
      return entityManager.find(Entity, 1).then(entity2 => [entity, entity2])
    }).then(([entity1, entity2]) => {
      expect(entity1).not.toBe(entity2)
      expect(entity1.id).toBe(1)
      expect(entity2.id).toBe(1)
    })
  })

  promiseIt("should resolve find() to the contained entity", () => {
    return entityManager.runTransaction(() => {
      return Promise.all([
        entityManager.find(Entity, 1),
        entityManager.find(Entity, 1)
      ])
    }).then(([entity1, entity2]) => {
      expect(entity1).toBe(entity2)
      expect(entity1.id).toBe(1)

      return entityManager.find(Entity, 1).then(entity => [entity, entity1])
    }).then(([entity1, entity2]) => {
      // persistence context is cleared after transaction
      expect(entity1).not.toBe(entity2)
    })
  })

  promiseIt("should perform read queries", () => {
    return entityManager.query(Entity).then((entities) => {
      expect(entities instanceof Array).toBeTruthy()
      expect(entities.length).toBe(2)
      expect(entities.every(entity => entity instanceof Entity)).toBeTruthy()
      expect(entities.some((entity) => {
        return entityManager.contains(entity)
      })).toBeFalsy()
      expect(entities.some((entity) => {
        return entityManager.containsByPrimaryKey(Entity, entity.id)
      })).toBeFalsy()

      return entityManager.query(Entity, { id: 2 })
    }).then((entities) => {
      expect(entities.length).toBe(1)
      expect(entities[0].id).toBe(2)

      return entityManager.query(Entity, null, ["!id"])
    }).then((entities) => {
      expect(entities[0].id).toBe(2)
      expect(entities[1].id).toBe(1)

      return entityManager.query(Entity, null, null, 1)
    }).then((entities) => {
      expect(entities.length).toBe(1)
      expect(entities[0].id).toBe(2)

      return entityManager.query(Entity, null, null, 0, 1)
    }).then((entities) => {
      expect(entities.length).toBe(1)
      expect(entities[0].id).toBe(1)
    })
  })

  promiseIt("should use the same entity store for find() and query()", () => {
    return entityManager.runTransaction(() => {
      return entityManager.find(Entity, 1).then((entity) => {
        return entityManager.query(Entity, 1).then(([entity2]) => {
          return [entity, entity2]
        })
      }).then(([entity1, entity2]) => {
        expect(entity1).toBe(entity2)

        return entityManager.query(Entity, 2)
      }).then(([entity]) => {
        return entityManager.find(Entity, 2).then(entity2 => [entity, entity2])
      }).then(([entity1, entity2]) => {
        expect(entity1).toBe(entity2)
      })
    })
  })

  promiseIt("should persist new entities", () => {
    return entityManager.runTransaction(() => {
      return entityManager.persist(new Entity({})).then((entity) => {
        expect(entityManager.contains(entity)).toBeTruthy()
        let {id} = entity
        expect(entityManager.containsByPrimaryKey(Entity, id)).toBeTruthy()
        return entity
      })
    }).then((entity) => {
      return entityManager.find(Entity, 3).then(entity2 => [entity, entity2])
    }).then(([entity1, entity2]) => {
      expect(entity1).toEqual(entity2)
      expect(entity1).not.toBe(entity2)
    })
  })

  promiseIt("should persist an entity outside a transaction", () => {
    return entityManager.persist(new Entity()).then((entity) => {
      return entityManager.find(Entity, entity.id).then((entity2) => {
        return [entity, entity2]
      })
    }).then(([entity1, entity2]) => {
      expect(entity1).toEqual(entity2)
      expect(entity1).not.toBe(entity2)
    })
  })

  promiseIt("must not persist the same entity multiple times", () => {
    return entityManager.runTransaction(() => {
      return entityManager.persist(new Entity({ id: 6 })).then(() => {
        return entityManager.persist(new Entity({ id: 6 }))
      })
    }).then(() => {
      throw new Error("fail this test")
    }).catch((error) => {
      expect(error.message).not.toBe("fail this test")
    })
  })

  promiseIt("should use shared context for find() and persist()", () => {
    return entityManager.runTransaction(() => {
      return entityManager.persist(new Entity({})).then((entity) => {
        return entityManager.find(Entity, entity.id).then((entity2) => {
          return [entity, entity2]
        })
      })
    }).then(([entity1, entity2]) => {
      expect(entity1).toBe(entity2)
    })
  })

  promiseIt("should remove existing entities", () => {
    return entityManager.remove(Entity, 1).then(() => {
      return entityManager.find(Entity, 1)
    }).then((entity) => {
      expect(entity).toBeNull()
    })
  })

  promiseIt("should do nothing when removing non-existing entities", () => {
    return entityManager.remove(Entity, -1).then(() => {
      return entityManager.query(Entity)
    }).then((entities) => {
      expect(entities.length).toBe(2)
    })
  })

  promiseIt("should remove deleted entities from the persistence context",
      () => {
    return entityManager.runTransaction(() => {
      return entityManager.find(Entity, 1).then((entity) => {
        expect(entityManager.contains(entity)).toBeTruthy()

        return entityManager.remove(Entity, 1).then(() => entity)
      }).then((entity) => {
        expect(entityManager.contains(entity)).toBeFalsy()
      })
    })
  })

  promiseIt("should perform update queries", () => {
    return entityManager.updateQuery(Entity, 2)((entity) => {
      expect(entity instanceof Entity).toBeTruthy()
      expect(entity.id).toBe(2)
      entity.marked1 = 1
    }).then((updatedCount) => {
      expect(updatedCount).toBe(1)

      return entityManager.query(Entity, { marked1: 1 })
    }).then((matchingEntities) => {
      expect(matchingEntities.length).toBe(1)

      return entityManager.updateQuery(
        Entity,
        null,
        "prev",
        0,
        1
      )((entity) => {
        entity.marked2 = "foo"
      })
    }).then((updatedEntitiesCount) => {
      expect(updatedEntitiesCount).toBe(1)

      return entityManager.query(Entity, { marked2: "foo" })
    }).then((entities) => {
      expect(entities.length).toBe(1)
    })
  })

  promiseIt("should use shared persistence context between find() and " +
      "updateQuery()", () => {
    let entity2
    return entityManager.runTransaction(() => {
      return entityManager.find(Entity, 1).then((entity1) => {
        return entityManager.updateQuery(Entity, 1)((entity) => {
          expect(entity).toBe(entity1)
        })
      }).then(() => {
        return entityManager.updateQuery(Entity, 2)((entity) => {
          entity2 = entity
        })
      }).then(() => {
        return entityManager.find(Entity, 2)
      }).then((entity) => {
        expect(entity).toBe(entity2)
      })
    })
  })

  promiseIt("should execute delete queries", () => {
    let entity1, entity2
    return entityManager.runTransaction(() => {
      return entityManager.query(Entity).then((entities) => {
        [entity1, entity2] = entities
        expect(entityManager.contains(entity1)).toBeTruthy()
        expect(entityManager.contains(entity2)).toBeTruthy()

        return entityManager.deleteQuery(Entity, null, "!id", 1, 10)
      }).then((deletedCount) => {
        expect(deletedCount).toBe(1)
        expect(entityManager.contains(entity1)).toBeFalsy()
        expect(entityManager.contains(entity2)).toBeTruthy()
      })
    })
  })

  promiseIt("should run delete queries also outside transactions", () => {
    return entityManager.deleteQuery(Entity, { id: 1 }).then((count) => {
      expect(count).toBe(1)

      return entityManager.query(Entity)
    }).then((entities) => {
      expect(entities.length).toBe(1)
    })
  })

  promiseIt("should allow detaching entities", () => {
    return entityManager.runTransaction(() => {
      entityManager.find(Entity, 1).then((entity) => {
        expect(entityManager.contains(entity)).toBeTruthy()
        expect(entityManager.containsByPrimaryKey(Entity, 1)).toBeTruthy()

        entityManager.detach(entity)
        expect(entityManager.contains(entity)).toBeFalsy()
        expect(entityManager.containsByPrimaryKey(Entity, 1)).toBeFalsy()
      })
    })
  })

  it("must not allow merging entities outside a transaction", () => {
    expect(() => {
      entityManager.merge(new Entity({}))
    }).toThrow()
  })

  promiseIt("should merge entities within a transaction", () => {
    return entityManager.runTransaction(() => {
      let entity = entityManager.merge(new Entity({
        id: 1,
        stuff: "entity field"
      }))
      expect(entity).toEqual(new Entity({ id: 1, stuff: "entity field" }))

      return entityManager.find(Entity, 1)
    }).then((entity) => {
      expect(entity).toEqual(new Entity({ id: 1, stuff: "entity field" }))

      return entityManager.find(Entity, 1)
    }).then((entity) => {
      expect(entity).toEqual(new Entity({ id: 1, stuff: "entity field" }))
    })
  })

  promiseIt("must reject merging entities without the primary key set", () => {
    return entityManager.runTransaction(() => {
      expect(() => {
        entityManager.merge(new Entity({}))
      }).toThrow()
    })
  })

  promiseIt("should refresh entities", () => {
    return entityManager.find(Entity, 1).then((entity) => {
      expect(entity).toEqual(new Entity({ id: 1, bar: "baz" }))
      entity.stuff = "foo"
      entity.bar = "foo"

      return entityManager.refresh(entity)
    }).then((entity) => {
      expect(entity).toEqual(new Entity({ id: 1, bar: "baz" }))

      return entityManager.runTransaction(() => {
        return entityManager.find(Entity, 1).then((entity) => {
          entity.stuff = "foo"
          entity.bar = "foo"

          return entityManager.refresh(entity)
        }).then((entity) => {
          expect(entity).toEqual(new Entity({ id: 1, bar: "baz" }))
        })
      })
    })
  })

  promiseIt("should clear its entity persistence context", () => {
    return entityManager.runTransaction(() => {
      return entityManager.find(Entity, 1).then((entity) => {
        expect(entityManager.contains(entity)).toBeTruthy()
        expect(entityManager.containsByPrimaryKey(Entity, 1)).toBeTruthy()
        entityManager.clear()
        expect(entityManager.contains(entity)).toBeFalsy()
        expect(entityManager.containsByPrimaryKey(Entity, 1)).toBeFalsy()
      })
    })
  })

})
