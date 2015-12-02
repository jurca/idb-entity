
import DBFactory from "../node_modules/indexed-db.es6/es2015/DBFactory"
import TransactionRunner from "../es2015/TransactionRunner"

describe("TransactionRunner", () => {

  const DB_NAME = "testingDB"
  const OBJECT_STORE_NAME = "foo"

  let database
  let runner

  beforeEach((done) => {
    DBFactory.open(DB_NAME, {
      version: 1,
      objectStores: [{
        name: OBJECT_STORE_NAME,
        autoIncrement: true
      }]
    }).then((db) => {
      database = db
      runner = getRunner()
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

  promiseIt("should handle a transaction", () => {
    return runner.commit()
  })

  promiseIt("should keep the transaction alive", () => {
    return delay(100).then(() => {
      return new Promise((resolve, reject) => {
        runner.queueOperation((transaction) => {
          let objectStore = transaction.getObjectStore(OBJECT_STORE_NAME)
          objectStore.get(1).then(resolve).catch(reject)
        })
      })
    }).then(() => {
      return runner.commit()
    })
  })

  promiseIt("should report whether a transaction is active", () => {
    expect(runner.isActive).toBeTruthy()
    return delay(100).then(() => {
      expect(runner.isActive).toBeTruthy()
      let commitPromise = runner.commit()
      expect(runner.isActive).toBeFalsy()
      return commitPromise
    })
  })

  promiseIt("should abort the transaction with an error", () => {
    let failed = false
    return runner.abort().then(() => {
      failed = true
      throw new Error()
    }).catch((error) => {
      if (failed) {
        throw new Error("The transaction must be aborted with an error")
      }
    })
  })

  promiseIt("should queue operations", () => {
    return delay(10).then(() => {
      return new Promise((resolve, reject) => {
        runner.queueOperation((transaction) => {
          let objectStore = transaction.getObjectStore(OBJECT_STORE_NAME)
          objectStore.add("bar").then(resolve).catch(reject)
        })
      })
    }).then((id) => {
      expect(id).toBe(1)
      return delay(10)
    }).then(() => {
      return new Promise((resolve, reject) => {
        runner.queueOperation((transaction) => {
          let objectStore = transaction.getObjectStore(OBJECT_STORE_NAME)
          objectStore.get(1).then(resolve).catch(reject)
        })
      })
    }).then((record) => {
      expect(record).toBe("bar")
    }).then(() => {
      runner.commit()
    })
  })

  promiseIt("should notify the observer if a transaction is idle", () => {
    let notifiedCount = 0
    return runner.commit().then(() => {
      let transaction = database.startTransaction(OBJECT_STORE_NAME)
      runner = new TransactionRunner(transaction, OBJECT_STORE_NAME, {
        ttl: 10000,
        warningDelay: 10,
        observer: (idleTransactionRunner, isAborted) => {
          if (isAborted) {
            throw new Error("The transaction must not be aborted")
          }

          expect(idleTransactionRunner).toBe(runner)
          notifiedCount++
        }
      })
    }).then(() => delay(1000)).then(() => {
      expect(notifiedCount).toBe(1)
      return runner.commit()
    })
  })

  promiseIt("should notify the observer if a transaction is aborted due to " +
      "being inactive", () => {
    let notifiedCount = 0
    return runner.commit().then(() => {
      let transaction = database.startTransaction(OBJECT_STORE_NAME)
      runner = new TransactionRunner(transaction, OBJECT_STORE_NAME, {
        ttl: 10,
        warningDelay: 10000,
        observer: (idleTransactionRunner, isAborted) => {
          if (!isAborted) {
            throw new Error("The warning should not have been issued")
          }

          expect(idleTransactionRunner).toBe(runner)
          notifiedCount++
        }
      })
    }).then(() => delay(1000)).then(() => {
      expect(notifiedCount).toBe(1)
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

  function delay(time) {
    return new Promise((resolve) => {
      setTimeout(resolve, time)
    })
  }

  function getRunner() {
    let transaction = database.startTransaction(OBJECT_STORE_NAME)
    return new TransactionRunner(transaction, OBJECT_STORE_NAME, {
      ttl: 3000,
      warningDelay: 1000,
      observer: (transaction, isAborted) => {
        if (isAborted) {
          console.error("A transaction has been aborted due to being idle " +
            "for too long")
        } else {
          console.warn("A transaction is idle for too long")
        }
      }
    })
  }

})
