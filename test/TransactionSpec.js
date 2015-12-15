
import DBFactory from "../node_modules/indexed-db.es6/es2015/DBFactory"
import EntityManager from "../es2015/EntityManager"
import Transaction from "../es2015/Transaction"
import TransactionRunner from "../es2015/TransactionRunner"

describe("Transaction", () => {

  const DB_NAME = "testingDB"
  const OBJECT_STORE_NAME = "foo"

  let database
  let idbEs6Transaction
  let containsByPrimaryKey
  let completionCalled
  let transaction

  beforeEach((done) => {
    containsByPrimaryKey = false
    completionCalled = false
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
      idbEs6Transaction.getObjectStore(OBJECT_STORE_NAME).add({
        bar: "baz"
      })
      idbEs6Transaction.getObjectStore(OBJECT_STORE_NAME).add({
        created: new Date()
      })
      transaction = getTransaction()
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

  function promiseIt(behavior, test) {
    it(behavior, (done) => {
      test().then(done).catch((error) => {
        fail(error)
        done()
      })
    })
  }

  function delay(time) {
    return new Promise((resolve) => {
      setTimeout(resolve, time)
    })
  }

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
      }),
      Promise.resolve(runner),
      new Map(),
      (entityClass, keyPath, data) => {
        if (data instanceof entityClass) {
          return data
        }

        return new entityClass(data)
      },
      () => {
        completionCalled = true
      }
    )
  }

})
