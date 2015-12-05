
import DBFactory from "../node_modules/indexed-db.es6/es2015/DBFactory"
import WriteOperationsProvider from "../es2015/WriteOperationsProvider"

describe("WriteOperationsProvider", () => {

  const DB_NAME = "testingDB"
  const OBJECT_STORE_NAME = "foo"

  let database

  beforeEach((done) => {
    DBFactory.open(DB_NAME, {
      version: 1,
      objectStores: [{
        name: OBJECT_STORE_NAME,
        autoIncrement: true
      }]
    }).then((db) => {
      database = db
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

})
