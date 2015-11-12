
import EntityManager from "./EntityManager"

/**
 * Private fields and methods.
 *
 * @type {Object<string, symbol>}
 */
const PRIVATE = Object.freeze({
  // fields
  connection: Symbol("connection"),
  entityKeyPaths: Symbol("entityKeyPaths"),

  // methods
  loadKeyPaths: Symbol("loadKeyPaths")
})

/**
 * The Entity Manager Factory is a factory class for creating entity managers.
 *
 * A new entity manager should always be created for each task, and the entity
 * manager should be cleared and disposed of once the task is complete.
 */
export default class EntityManagerFactory {
  /**
   * Initializes the entity manager factory.
   *
   * @param {(Database|Promise<Database>)} databaseConnection The connection to
   *        the database or a promise that will resolve into a connection to
   *        the database.
   */
  constructor(databaseConnection) {
    let connectionPromise = databaseConnection instanceof Promise ?
        databaseConnection : Promise.resolve(databaseConnection)
    
    /**
     * The promise that provides a connection to the database.
     *
     * @type {Promise<Database>}
     */
    this[PRIVATE.connection] = connectionPromise

    /**
     * Shared cache of primary key key paths for object stores. The keys are
     * object store names.
     *
     * @type {Map<string, (string|string[])>}
     */
    this[PRIVATE.entityKeyPaths] = new Map()

    Object.freeze(this)

    if (databaseConnection instanceof Promise) {
      databaseConnection.then((database) => {
        this[PRIVATE.loadKeyPaths](database)
      })
    } else {
      this[PRIVATE.loadKeyPaths](databaseConnection)
    }
  }

  /**
   * Creates a new entity manager.
   *
   * The entity manager will not use any persistent transaction unless one is
   * explicitly started, because an entity manager transaction always needs to
   * lock all object stores in the database.
   *
   * @return {EntityManager} The created entity manager.
   */
  createEntityManager() {
    return new EntityManager(
      this[PRIVATE.connection],
      this[PRIVATE.entityKeyPaths]
    )
  }

  /**
   * Terminates the connection to the database as soon as possible. The
   * returned promise will resolve once the connection has been terminated.
   *
   * @return {Promise<undefined>} A promise that will resolve once the
   *         connection has been terminated.
   */
  close() {
    return this[PRIVATE.connection].then((database) => {
      return database.close()
    })
  }

  /**
   * Loads the primary key key paths of all object stores in the database.
   *
   * @param {Database} database The connection to the database.
   */
  [PRIVATE.loadKeyPaths](database) {
    database.runReadOnlyTransaction(database.objectStoreNames, (...stores) => {
      stores.pop() // get rid of the transaction abort callback

      for (let store of stores) {
        this[PRIVATE.entityKeyPaths].set(store.name, store.keyPath)
      }
    })

    Object.freeze(this[PRIVATE.entityKeyPaths])
  }
}
