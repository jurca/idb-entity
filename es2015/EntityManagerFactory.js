
import EntityManager from "./EntityManager"

/**
 * Private fields and methods.
 *
 * @type {Object<string, symbol>}
 */
const PRIVATE = Object.freeze({
  // fields
  connection: Symbol("connection"),
  options: Symbol("options"),
  entityKeyPaths: Symbol("entityKeyPaths"),

  // methods
  loadKeyPaths: Symbol("loadKeyPaths"),
  prepareOptions: Symbol("prepareOptions")
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
   * @param {{idleTransactions: {ttl: number=, warningDelay: number=, observer: function(Transaction, boolean, ?Error)=}=}=} options
   *        Optional entity manager configuration. The
   *        {@code idleTransactions} option configures how the active
   *        transactions that have no operations pending will be treated:
   *        - the {@code ttl} specified the maximum number of milliseconds a
   *          transaction can be idle (with no pending operations) before it is
   *          automatically aborted. Defaults to 1 minute (60 000
   *          milliseconds). The {@code observer} will be notified AFTER the
   *          transaction has been aborted.
   *        - the {@code warningDelay} specified the maximum number of
   *          milliseconds a transaction can be idle (with no pending
   *          operations) before the observer will be notified about the
   *          transaction's inactivity. If the value is greater than the
   *          {@code ttl}, the observer will not receive any warning. Defaults
   *          to 3 seconds (3 000 milliseconds).
   *        - the {@code observer} function will be called every time a
   *          transaction is idle for too long (depending on the {@code ttl}
   *          and {@code warningDelay} values). The first argument will be the
   *          entity manager transaction at hand. The second argument will be
   *          set to {@code true} if the transaction has been aborted, it will
   *          be set to {@code false} otherwise. Defaults to a function that
   *          will output a warning (when a transaction reaches the
   *          {@code warningDelay}) or an error (when a transaction reaches the
   *          {@code ttl}) to the console.
   */
  constructor(databaseConnection, options = {}) {
    let connectionPromise = databaseConnection instanceof Promise ?
        databaseConnection : Promise.resolve(databaseConnection)
    let initializedConnectionPromise = connectionPromise.then((database) => {
      this[PRIVATE.loadKeyPaths](database)

      return database
    })
    
    /**
     * The promise that provides a connection to the database.
     *
     * @type {Promise<Database>}
     */
    this[PRIVATE.connection] = initializedConnectionPromise

    /**
     * The entity manager configuration.
     *
     * @type {{idleTransactions: {ttl: number, warningDelay: number, observer: function(Transaction, boolean, ?Error)}}}
     */
    this[PRIVATE.options] = this[PRIVATE.prepareOptions](options)

    /**
     * Shared cache of primary key key paths for object stores. The keys are
     * object store names.
     *
     * @type {Map<string, (string|string[])>}
     */
    this[PRIVATE.entityKeyPaths] = new Map()

    Object.freeze(this)
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
      this[PRIVATE.options],
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

  /**
   * Prepares the provided options object for use by creating a copy with
   * filled-in defaults. The returned object will be deep-frozen.
   *
   * @param {{idleTransactions: {ttl: number=, warningDelay: number=, observer: function(Transaction, boolean, ?Error)=}=}=} providedOptions
   *        The entity manager options provided by the entity manager factory's
   *        client.
   * @return {{idleTransactions: {ttl: number, warningDelay: number, observer: function(Transaction, boolean, ?Error)}}}
   *         The provided entity manager options with missing fields filled in
   *         and frozen state.
   */
  [PRIVATE.prepareOptions](providedOptions) {
    let options = Object.assign({
    }, providedOptions)

    options.idleTransactions = Object.assign({
      ttl: 60000,
      warningDelay: 3000,
      observer: (transaction, isAborted, error) => {
        if (error) {
          if (error.name !== "AbortError") {
            console.error("An unexpected error occurred while the entity " +
                "manager was trying to abort an idle transaction", error)
          }
          return // transaction has been aborted, everything is OK
        }

        if (isAborted) {
          console.error("Aborting an idle transaction due to being idle for " +
              "too long. A transaction must be manually committed or " +
              "aborted to prevent this from happening.")
        } else {
          console.warn("Detected an idle pending transaction. The " +
              "transaction will be aborted unless a new operation is " +
              "scheduled or the transaction is committed")
        }
      }
    }, providedOptions.idleTransactions)

    Object.freeze(options.idleTransactions)
    Object.freeze(options)

    return options
  }
}
