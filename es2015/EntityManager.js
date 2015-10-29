
import {validateEntityClass, getPrimaryKey, clone, serializeKey} from "./utils"
import Transaction from "./Transaction"
import AbstractEntity from "./AbstractEntity"

/**
 * Private field and method symbols.
 *
 * @type {Object<string, symbol>}
 */
const PRIVATE = Object.freeze({
  // fields
  connection: Symbol("connection"),
  entities: Symbol("entities"),
  entityKeyPaths: Symbol("entityKeyPaths"),
  activeTransaction: Symbol("activeTransaction"),

  //methods
  manage: Symbol("manage"),
  registerKeyPath: Symbol("registerKeyPath")
})

/**
 * Manager of entities and operations on them. The entity manager ensures that
 * each entity managed by this entity manager is always represented by the same
 * object even if retrieved multiple times from the database.
 */
export default class EntityManager {
  /**
   * Initializes the entity manager.
   *
   * @param {Promise<Database>} databaseConnection  The promise that will
   *        resolve to a connection to the database.
   * @param {Map<function(new: AbstractEntity, data: Object<string, *>), (string|string[])>} entityKeyPaths
   *        Shared map of entity classes to entity primary key key paths.
   */
  constructor(databaseConnection, entityKeyPaths) {
    /**
     * The promise that will resolve to a connection to the database.
     *
     * @type {Promise<Database>}
     */
    this[PRIVATE.connection] = databaseConnection
    
    /**
     * Registry of currently managed entities. The registry is a map of entity
     * classes to a map of serialized entity primary keys to entity source data
     * and entity instances.
     *
     * @type {Map<function(new: AbstractEntity, data: Object<string, *>), Map<string, {data: *, entity: AbstractEntity}>>}
     */
    this[PRIVATE.entities] = new Map()

    /**
     * Shared map of entity classes to entity primary key key paths.
     *
     * @type {Map<function(new: AbstractEntity, data: Object<string, *>), (string|string[])>}
     */
    this[PRIVATE.entityKeyPaths] = entityKeyPaths

    /**
     * The currently active read-write database-wide transaction on this entity
     * manager.
     *
     * @type {?Transaction}
     */
    this[PRIVATE.activeTransaction] = false
  }

  /**
   * Checks whether the provided entity is an entity managed by this entity
   * manager.
   *
   * @param {AbstractEntity} entity
   * @return {boolean} {@code true} if the provided entity is managed by this
   *         entity manager.
   */
  contains(entity) {
    let entityClass = entity.constructor

    if (!this[PRIVATE.entities].has(entityClass)) {
      return false
    }

    let keysToEntities = this[PRIVATE.entities].get(entityClass)
    let keyPath = this[PRIVATE.entityKeyPaths].get(entityClass)
    let primaryKey = getPrimaryKey(entity, keyPath)
    let serializedKey = serializeKey(primaryKey)
    if (!keysToEntities.has(serializeKey(serializedKey))) {
      return false
    }

    return keysToEntities.get(serializeKey(serializedKey)).entity === entity
  }

  containsByPrimaryKey(entityClass, primaryKey) {
    if (!this[PRIVATE.entities].has(entityClass)) {
      return false
    }

    let keysToEntities = this[PRIVATE.entities].get(entityClass)
    let serializedKey = serializeKey(primaryKey)
    if (!keysToEntities.has(serializeKey(serializedKey))) {
      return false
    }
  }

  /**
   * Retrieves the entity matching the specified primary key from the database.
   *
   * The entity will not be locked in the database nor managed by this entity
   * manager if the entity manager transaction is not in progress.
   *
   * @template {T} extends AbstractEntity
   * @param {function(new: T, data: Object<string, *>)} entityClass The entity
   *        class specifying the type of entity to retrieve.
   * @param {(number|string|Date|Array)} primaryKey The primary key identifying
   *        the entity.
   * @return {Promise<?T>} A promise that will resolve to the entity, or
   *         {@code null} if the entity does not exist.
   */
  find(entityClass, primaryKey) {
    validateEntityClass(entityClass)
    
    let storeName = entityClass.objectStore
    let keyPath

    // TODO: search the local persistence context first before fetching

    return this[PRIVATE.connection].then((database) => {
      return database.runReadOnlyTransaction(storeName, (objectStore) => {
        keyPath = objectStore.keyPath
        return objectStore.get(primaryKey)
      })
    }).then((entityData) => {
      if (entityData) {
        return this[PRIVATE.manage](entityClass, keyPath, entityData)
      }

      return null
    })
  }

  /**
   * Fetches the entities matched by the specified query.
   *
   * @template {T} extends AbstractEntity
   * @param {function(new: T, data: Object<string, *>)} entityClass The entity
   *        class, specifying the type of entities to fetch.
   * @param {?(undefined|number|string|Date|Array|IDBKeyRange|Object<string, (number|string|Date|Array|IDBKeyRange)>|function(*, (number|string|Date|Array)): boolean)=} filter
   *        The filter, restricting the records returned by this method. If a
   *        function is provided, the first argument will be set to the record
   *        and the second argument will be set to the primary key of the
   *        record.
   * @param {?(CursorDirection|string|string[]|function(*, *): number)} order
   *        How the resulting records should be sorted.
   * @param {number} offset The index of the first record to include in the
   *        result. The records are numbered from {@code 0}, the offset must be
   *        a non-negative integer.
   * @param {?number} limit The maximum number of records to return as a
   *        result. The limit must be a positive integer, or {@code null} if no
   *        limit should be imposed.
   * @return {Promise<T[]>} A promise that resolves to the records matched by
   *         the specified query.
   */
  query(entityClass, filter = null, order = null, offset = 0, limit = null) {
    validateEntityClass(entityClass)

    let storeName = entityClass.objectStore
    let keyPath

    return this[PRIVATE.connection].then((database) => {
      return database.runReadOnlyTransaction(storeName, (objectStore) => {
        keyPath = objectStore.keyPath
        return objectStore.query(filter, order, offset, limit)
      })
    }).then((entities) => {
      return entities.map((entityData) => {
        return this[PRIVATE.manage](entityClass, keyPath, entityData)
      })
    })
  }

  /**
   * Creates the provided entity in the database. If the entity does not have
   * its primary key set and the entity's object store generates primary keys
   * for new records automatically, the entity will have its primary key set
   * when this operation completes.
   *
   * The created entity will be managed by this entity manager.
   *
   * Note that if any of the entities currently managed by this entity manager
   * have been modified, their changes will be persisted. Also, this method
   * cannot be used while a transaction is active on this entity manager.
   *
   * @template {T} extends AbstractEntity
   * @param {T} entity The entity to create in the database.
   * @return {Promise<T>} A promise that resolves when the entity has been
   *         saved. The promise will resolve to the saved entity.
   */
  persist(entity) {
    return this.runTransaction((transaction) => {
      return transaction.persist(entity)
    }).then(() => entity)
  }

  /**
   * Deletes the specified entity. If the entity is managed by this entity
   * manager, it will become detached.
   *
   * Note that if any of the entities currently managed by this entity manager
   * have been modified, their changes will be persisted. Also, this method
   * cannot be used while a transaction is active on this entity manager.
   *
   * @template {T} extends AbstractEntity
   * @param {function(new: T, data: Object<string, *>)} entityClass The entity
   *        class.
   * @param {(number|string|Date|Array)} entityPrimaryKey The primary key of
   *        the entity to delete.
   * @return {Promise<undefined>} A promise that resolves when the entity has
   *         been deleted.
   */
  remove(entityClass, entityPrimaryKey) {
    return this.runTransaction((transaction) => {
      return transaction.remove(entityClass, entityPrimaryKey)
    })
  }

  /**
   * Updates the records matched by the specified query.
   *
   * Note that if any of the entities currently managed by this entity manager
   * have been modified, their changes will be persisted. Also, this method
   * cannot be used while a transaction is active on this entity manager.
   *
   * @template {T} extends AbstractEntity
   * @param {function(new: T, data: Object<string, *>)} entityClass The entity
   *        class, specifying the type of entities to match.
   * @param {?(undefined|number|string|Date|Array|IDBKeyRange|Object<string, (number|string|Date|Array|IDBKeyRange)>|function(*, (number|string|Date|Array)): boolean)=} filter
   *        The filter, restricting the records affected by this method. If a
   *        function is provided, the first argument will be set to the record
   *        and the second argument will be set to the primary key of the
   *        record.
   * @param {?(CursorDirection|string|string[]|function(*, *): number)} order
   *        How the records should be sorted.
   * @param {number} offset The index of the first record to modify. The
   *        records are numbered from {@code 0}, the offset must be a
   *        non-negative integer.
   * @param {?number} limit The maximum number of records to modify. The limit
   *        must be a positive integer, or {@code null} if no limit should be
   *        imposed.
   * @return {function(function(T)): Promise<number>} A function that executes
   *         the update query, and returns a promise that resolves to the
   *         number of records matched by the query. The function accepts a
   *         callback that is invoked for each record to modify them.
   */
  updateQuery(entityClass, filter = null, order = "next", offset = 0,
      limit = null) {
    return (recordCallback) => {
      return this.runTransaction((transaction) => {
        return transaction.updateQuery(
          entityClass,
          filter,
          order,
          offset,
          limit
        )(recordCallback)
      })
    }
  }

  /**
   * Deletes the entities matched by the specified query. If any of the matched
   * entities are currently managed by this entity manager, they will become
   * detached.
   *
   * Note that if any of the entities currently managed by this entity manager
   * have been modified, their changes will be persisted. Also, this method
   * cannot be used while a transaction is active on this entity manager.
   *
   * @template {T} extends AbstractEntity
   * @param {function(new: T, data: Object<string, *>)} entityClass The entity
   *        class, specifying the type of entities to delete.
   * @param {?(undefined|number|string|Date|Array|IDBKeyRange|Object<string, (number|string|Date|Array|IDBKeyRange)>|function(*, (number|string|Date|Array)): boolean)=} filter
   *        The filter, restricting the records deleted by this method. If a
   *        function is provided, the first argument will be set to the record
   *        and the second argument will be set to the primary key of the
   *        record.
   * @param {?(CursorDirection|string|string[]|function(*, *): number)} order
   *        How the records should be sorted.
   * @param {number} offset The index of the first record to delete. The
   *        records are numbered from {@code 0}, the offset must be a
   *        non-negative integer.
   * @param {?number} limit The maximum number of records to delete. The limit
   *        must be a positive integer, or {@code null} if no limit should be
   *        imposed.
   * @return {Promise<number>} A promise that will resolve after the records
   *         have been deleted. The promise will resolve to the number of
   *         deleted records.
   */
  deleteQuery(entityClass, filter = null, order = "next", offset = 0,
      limit = null) {
    return this.runTransaction((transaction) => {
      return transaction.deleteQuery(entityClass, filter, order, offset, limit)
    })
  }

  /**
   * Starts a new transaction if there is not already one active.
   *
   * Note that multiple simultaneous transactions cannot be started from the
   * same entity manager. A transaction also cannot be started while a write
   * operation (entity creation, modification of deletion or entity
   * modification or deletion query) is in progress.
   *
   * @return {Transaction} The started transaction.
   * @throws {Error} Thrown if there already is a transaction in progress on
   *         this entity manager.
   */
  startTransaction() {
    if (this[PRIVATE.activeTransaction]) {
      throw new Error("This entity manager is already running a transaction")
    }

    this[PRIVATE.activeTransaction] = new Transaction(
      this,
      this[PRIVATE.connection],
      this[PRIVATE.entities],
      (entityClass, keyPath, entityData) => {
        return this[PRIVATE.manage](entityClass, keyPath, entityData)
      },
      () => {
        this[PRIVATE.activeTransaction] = null
      }
    )

    return this[PRIVATE.activeTransaction]
  }

  /**
   * The methods starts a new transaction and executes the provided callback
   * within it. The waits for the operations started by the callback to finish,
   * then commits the transaction and resolves to the value returned by the
   * promise returned by the provided operations callback.
   *
   * Note that multiple simultaneous transactions cannot be started from the
   * same entity manager. A transaction also cannot be started while a write
   * operation (entity creation, modification of deletion or entity
   * modification or deletion query) is in progress.
   *
   * @template R
   * @param {function(Transaction): Promise<R>} operations The callback that
   *        will execute the operations within the transaction. The callback
   *        must return a promise that resolves once all operations have been
   *        performed.
   * @return {Promise<R>} A promise that resolves to the value the promise
   *         returned by the provided operations callback resolved to.
   */
  runTransaction(operations) {
    let transaction = this.startTransaction()
    return Promise.resolve().then(() => {
      return operations(transaction)
    }).then((result) => {
      return transaction.commit().then(() => result)
    }).catch((error) => {
      transaction.abort()
      throw error
    })
  }

  /**
   * Detaches the provided entity from this entity manager. This entity manager
   * will no longer watch changes in the provided entity during transactions.
   *
   * @param {AbstractEntity} entity The entity to detach from this entity
   *        manager.
   */
  detach(entity) {
    let entityClass = entity.constructor
    if (!this[PRIVATE.entities].has(entityClass)) {
      return // the entity is not managed by this entity manager, so we're done
    }

    let entities = this[PRIVATE.entities].get(entityClass)
    let keyPath = this[PRIVATE.entityKeyPaths].get(entityClass)

    let primaryKey = getPrimaryKey(entity, keyPath)
    let serializedKey = serializeKey(primaryKey)
    entities.delete(serializedKey)
  }

  merge(entity) {}

  refresh(entity) {}

  /**
   * Clears this entity manager, detaching all previously attached entities.
   */
  clear() {
    this[PRIVATE.entities].clear()
  }

  /**
   * Tests whether there is already an entity representing the provided record.
   * The method returns the already managed entity if there is one, otherwise
   * the method creates a new entity from the provided record, registers and
   * returns it.
   *
   * @template {T} extends AbstractEntity
   * @param {function(new: T, data: Object<string, *>)} entityClass The entity
   *        class.
   * @param {(string|string[])} keyPath Entity primary key key path.
   * @param {Object<string, *>} entityData The record containing the data from
   *        which the entity should be constructed.
   * @return {T} The already managed entity or a newly created managed entity
   *         created out of the provided data.
   */
  [PRIVATE.manage](entityClass, keyPath, entityData) {
    this[PRIVATE.registerKeyPath](entityClass, keyPath)

    if (!this[PRIVATE.entities].has(entityClass)) {
      this[PRIVATE.entities].set(entityClass, new Map())
    }

    let entities = this[PRIVATE.entities].get(entityClass)
    let entity = new entityClass(entityData)
    let primaryKey = getPrimaryKey(entity, keyPath)
    let serializedKey = serializeKey(primaryKey)

    if (entities.has(serializedKey)) {
      return entities.get(serializedKey).entity
    }

    let serializedKey = serializeKey(primaryKey)
    entities.set(serializedKey, {
      data: clone(entityData),
      entity
    })

    return entity
  }

  /**
   * Registers the provided entity primary key key path, if it is not
   * registered already.
   *
   * @param {function(new: AbstractEntity, data: Object<string, *>)} entityClass
   *        The entity class.
   * @param {(string|string[])} keyPath Entity primary key key path.
   */
  [PRIVATE.registerKeyPath](entityClass, keyPath) {
    if (!this[PRIVATE.entityKeyPaths].has(entityClass)) {
      this[PRIVATE.entityKeyPaths].set(entityClass, keyPath)
    }
  }
}
