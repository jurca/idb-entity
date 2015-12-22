
import DBFactory from "../node_modules/indexed-db.es6/es2015/DBFactory"
import AbstractEntity from "../es2015/AbstractEntity"
import EntityManagerFactory from "../es2015/EntityManagerFactory"
import {promiseIt} from "./testUtils"

describe("EntityManagerFactory", () => {

  const DB_NAME = "testingDB"
  const OBJECT_STORE_NAME = "foo"
  const DB_SCHEMA = {
    version: 1,
    objectStores: [{
      name: OBJECT_STORE_NAME,
      keyPath: "id",
      autoIncrement: true
    }]
  }

  class Entity extends AbstractEntity {
    static get objectStore() {
      return OBJECT_STORE_NAME
    }
  }

  afterEach((done) => {
    Promise.resolve().then(() => {
      return DBFactory.deleteDatabase(DB_NAME)
    }).then(() => {
      done()
    }).catch((error) => {
      fail(error)
      done()
    })
  })

  promiseIt("should accept opened database connection", () => {
    return createConnection().then((db) => {
      let factory = new EntityManagerFactory(db)
      let manager = factory.createEntityManager()
      return manager.persist(new Entity({})).then(entity => [entity, factory])
    }).then(([entity, factory]) => {
      expect(entity).toEqual(new Entity({ id: 1 }))

      return factory.close()
    })
  })

  promiseIt("should accept promise of database connection", () => {
    let connectionPromise = createConnection()
    let factory = new EntityManagerFactory(connectionPromise)
    let manager = factory.createEntityManager()
    return manager.persist(new Entity({})).then((entity) => {
      expect(entity).toEqual(new Entity({ id: 1 }))

      return factory.close()
    })
  })

  promiseIt("should have its object store key paths fetched", () => {
    let connectionPromise = createConnection()
    let factory = new EntityManagerFactory(connectionPromise)
    let manager = factory.createEntityManager()
    return manager.runTransaction(() => {
      manager.merge(new Entity({ id: 1, stuff: true }))
    }).then(() => {
      return manager.find(Entity, 1)
    }).then((entity) => {
      expect(entity).toEqual(new Entity({ id: 1, stuff: true }))

      return factory.close()
    }).catch((error) => {
      return factory.close().then(() => Promise.reject(error))
    })
  })

  promiseIt("should reject merging an entity before loading key paths", () => {
    let connectionPromise = createConnection()
    let factory = new EntityManagerFactory(connectionPromise)
    let manager = factory.createEntityManager()
    let transaction = manager.startTransaction()

    expect(() => {
      manager.merge(new Entity({ id: 1 }))
    }).toThrow()

    return transaction.commit().then(() => {
      factory.close()
    })
  })

  function createConnection() {
    return DBFactory.open(DB_NAME, DB_SCHEMA)
  }

})
