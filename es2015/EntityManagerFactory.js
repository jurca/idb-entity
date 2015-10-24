
import EntityManager from "./EntityManager"

/**
 * Private fields and methods.
 *
 * @type {Object<string, symbol>}
 */
const PRIVATE = Object.freeze({
  connection: Symbol("connection"),
  entityKeyPaths: Symbol("entityKeyPaths")
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
     * Shared cache of primary key key paths for entity classes.
     *
     * @type {Map<function(new: AbstractEntity, data: Object<string, *>), (string|string[])>}
     */
    this[PRIVATE.entityKeyPaths] = new Map()
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
}
