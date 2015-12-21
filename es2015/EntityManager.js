
import {validateEntityClass, getPrimaryKey, clone, serializeKey} from "./utils"
import AbstractEntity from "./AbstractEntity"
import Transaction from "./Transaction"
import TransactionRunner from "./TransactionRunner"

/**
 * Private field and method symbols.
 *
 * @type {Object<string, symbol>}
 */
const PRIVATE = Object.freeze({
  // fields
  connection: Symbol("connection"),
  options: Symbol("options"),
  entities: Symbol("entities"),
  entityKeyPaths: Symbol("entityKeyPaths"),
  rwTransactionRunner: Symbol("rwTransactionRunner"),
  activeTransaction: Symbol("activeTransaction"),

  //methods
  manage: Symbol("manage"),
  runTransactionOperation: Symbol("runTransactionOperation"),
  deleteExtraneousFields: Symbol("deleteExtraneousFields")
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
   * @param {{idleTransactions: {ttl: number, warningDelay: number, observer: function(Transaction, boolean, ?Error)}}} options
   *        Entity manager options. See the constructor of the
   *        {@linkcode EntityManagerFactory} for details.
   * @param {Map<function(new: AbstractEntity, data: Object<string, *>), (string|string[])>} entityKeyPaths
   *        Shared map of entity classes to entity primary key key paths.
   * @see EntityManagerFactory#constructor
   */
  constructor(databaseConnection, options, entityKeyPaths) {
    /**
     * The promise that will resolve to a connection to the database.
     *
     * @type {Promise<Database>}
     */
    this[PRIVATE.connection] = databaseConnection

    /**
     * The entity manager configuration.
     *
     * @type {{idleTransactions: {ttl: number, warningDelay: number, observer: function(Transaction, boolean, ?Error)}}}
     */
    this[PRIVATE.options] = options
    
    /**
     * Registry of currently managed entities. The registry is a map of entity
     * classes to a map of serialized entity primary keys to entity source data
     * and entity instances.
     *
     * @type {Map<function(new: AbstractEntity, Object<string, *>), Map<string, {data: *, entity: AbstractEntity, foreign: boolean=}>>}
     */
    this[PRIVATE.entities] = new Map()

    /**
     * Shared cache of primary key key paths for object stores. The keys are
     * object store names.
     *
     * @type {Map<string, (string|string[])>}
     */
    this[PRIVATE.entityKeyPaths] = entityKeyPaths

    /**
     * The promise that will resolve to the transaction for the currently
     * active indexed-db.es6 read-write transaction. This field is set only if
     * a read-write transaction has been started and has not ended yet.
     *
     * @type {?Promise<TransactionRunner>}
     */
    this[PRIVATE.rwTransactionRunner] = null

    /**
     * The currently active read-write transaction.
     *
     * @type {?Transaction}
     */
    this[PRIVATE.activeTransaction] = null

    let readOnlyFields = [
      PRIVATE.connection,
      PRIVATE.options,
      PRIVATE.entities,
      PRIVATE.entityKeyPaths
    ]
    for (let readOnlyField of readOnlyFields) {
      Object.defineProperty(this, readOnlyField, {
        writable: false
      })
    }
    Object.seal(this)
  }

  /**
   * Checks whether the provided entity is an entity managed by this entity
   * manager.
   *
   * @param {AbstractEntity} entity The entity.
   * @return {boolean} {@code true} if the provided entity is managed by this
   *         entity manager.
   */
  contains(entity) {
    if (!(entity instanceof AbstractEntity)) {
      throw new TypeError("The entity must be an AbstractEntity instance, " +
          `${entity} provided`)
    }
    let entityClass = entity.constructor
    validateEntityClass(entityClass)

    if (!this[PRIVATE.entities].has(entityClass)) {
      return false
    }

    let keysToEntities = this[PRIVATE.entities].get(entityClass)
    let keyPath = this[PRIVATE.entityKeyPaths].get(entityClass.objectStore)
    let primaryKey = getPrimaryKey(entity, keyPath)
    let serializedKey = serializeKey(primaryKey)
    if (!keysToEntities.has(serializedKey)) {
      return false
    }

    return keysToEntities.get(serializedKey).entity === entity
  }

  /**
   * Checks whether an entity of the specified type and identified by the
   * provided primary key is currently managed by this entity manager.
   *
   * @template {T} extends AbstractEntity
   * @param {function(new: T, Object<string, *>)} entityClass The type of the
   *        entity to check for.
   * @param {(number|string|Date|Array)} primaryKey The primary key identifying
   *        the entity.
   * @return {boolean} {@code true} if the specified entity is managed by this
   *         entity manager.
   */
  containsByPrimaryKey(entityClass, primaryKey) {
    validateEntityClass(entityClass)

    if (!this[PRIVATE.entities].has(entityClass)) {
      return false
    }

    let keysToEntities = this[PRIVATE.entities].get(entityClass)
    let serializedKey = serializeKey(primaryKey)
    return keysToEntities.has(serializedKey)
  }

  /**
   * Retrieves the entity matching the specified primary key from the database.
   *
   * The entity will not be locked in the database nor managed by this entity
   * manager if an entity manager transaction is not in progress.
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

    if (this[PRIVATE.entities].has(entityClass)) {
      let keysToEntities = this[PRIVATE.entities].get(entityClass)
      let serializedPrimaryKey = serializeKey(primaryKey)
      if (keysToEntities.has(serializedPrimaryKey)) {
        return Promise.resolve(keysToEntities.get(serializedPrimaryKey).entity)
      }
    }

    let storeName = entityClass.objectStore

    if (this[PRIVATE.rwTransactionRunner]) {
      let keyPath
      return this[PRIVATE.runTransactionOperation]((transaction) => {
        let objectStore = transaction.getObjectStore(storeName)
        keyPath = objectStore.keyPath
        return objectStore.get(primaryKey)
      }).then((entityData) => {
        if (entityData) {
          return this[PRIVATE.manage](entityClass, keyPath, entityData)
        }

        return null
      })
    }

    return this[PRIVATE.connection].then((database) => {
      return database.runReadOnlyTransaction(storeName, (objectStore) => {
        return objectStore.get(primaryKey)
      })
    }).then((entityData) => {
      if (entityData) {
        return new entityClass(entityData)
      }

      return null
    })
  }

  /**
   * Fetches the entities matched by the specified query.
   *
   * The entities will not be locked in the database nor managed by this entity
   * manager if an entity manager transaction is not in progress.
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

    if (this[PRIVATE.rwTransactionRunner]) {
      let keyPath
      return this[PRIVATE.runTransactionOperation]((transaction) => {
        let objectStore = transaction.getObjectStore(storeName)
        keyPath = objectStore.keyPath
        return objectStore.query(filter, order, offset, limit)
      }).then((entities) => {
        return entities.map((entityData) => {
          return this[PRIVATE.manage](entityClass, keyPath, entityData)
        })
      })
    }

    return this[PRIVATE.connection].then((database) => {
      return database.runReadOnlyTransaction(storeName, (objectStore) => {
        return objectStore.query(filter, order, offset, limit)
      })
    }).then((records) => {
      return records.map(record => new entityClass(record))
    })
  }

  /**
   * Creates the provided entity in the database. If the entity does not have
   * its primary key set and the entity's object store generates primary keys
   * for new records automatically, the entity will have its primary key set
   * when this operation completes.
   *
   * The created entity will be managed by this entity manager for the duration
   * of the current transaction.
   *
   * @template {T} extends AbstractEntity
   * @param {T} entity The entity to create in the database.
   * @return {Promise<T>} A promise that resolves when the entity has been
   *         saved. The promise will resolve to the saved entity.
   */
  persist(entity) {
    if (!(entity instanceof AbstractEntity)) {
      throw new TypeError("The entity must be an AbstractEntity instance")
    }
    validateEntityClass(entity.constructor)

    if (this[PRIVATE.activeTransaction]) {
      return this[PRIVATE.activeTransaction].persist(entity)
    }

    return this.runTransaction((transaction) => {
      return transaction.persist(entity)
    }).then(() => entity)
  }

  /**
   * Deletes the specified entity. If the entity is managed by this entity
   * manager, it will become detached.
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
    validateEntityClass(entityClass)

    if (this[PRIVATE.activeTransaction]) {
      return this[PRIVATE.activeTransaction].remove(
        entityClass,
        entityPrimaryKey
      )
    }

    return this.runTransaction((transaction) => {
      return transaction.remove(entityClass, entityPrimaryKey)
    })
  }

  /**
   * Updates the records matched by the specified query.
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
    validateEntityClass(entityClass)

    return (recordCallback) => {
      if (this[PRIVATE.activeTransaction]) {
        return this[PRIVATE.activeTransaction].updateQuery(
          entityClass,
          filter,
          order,
          offset,
          limit
        )(recordCallback)
      }

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
    validateEntityClass(entityClass)

    if (this[PRIVATE.activeTransaction]) {
      return this[PRIVATE.activeTransaction].deleteQuery(
        entityClass,
        filter,
        order,
        offset,
        limit
      )
    }

    return this.runTransaction((transaction) => {
      return transaction.deleteQuery(entityClass, filter, order, offset, limit)
    })
  }

  /**
   * Starts a new transaction if there is not already one active. All entities
   * that will become managed by this entity manager during the transaction
   * will have their changes automatically persisted when the transaction is
   * committed.
   *
   * Note that multiple simultaneous transactions cannot be started from the
   * same entity manager. The transaction will lock all object stores in the
   * database until the transaction completes.
   *
   * The persistence context of this entity manager will be cleared after the
   * transaction completes (all entities will become detached).
   *
   * @return {Transaction} The started transaction.
   * @throws {Error} Thrown if there already is a transaction in progress on
   *         this entity manager.
   */
  startTransaction() {
    if (this[PRIVATE.activeTransaction]) {
      throw new Error("This entity manager is already running a transaction")
    }

    this[PRIVATE.rwTransactionRunner] = this[PRIVATE.connection].then((db) => {
      let transaction = db.startTransaction(db.objectStoreNames)
      return new TransactionRunner(
        transaction,
        db.objectStoreNames[0],
        this[PRIVATE.activeTransaction],
        this[PRIVATE.options].idleTransactions
      )
    })

    this[PRIVATE.activeTransaction] = new Transaction(
      this,
      this[PRIVATE.rwTransactionRunner],
      this[PRIVATE.entities],
      (entityClass, keyPath, entityData) => {
        return this[PRIVATE.manage](entityClass, keyPath, entityData)
      },
      () => {
        this[PRIVATE.rwTransactionRunner] = null
        this[PRIVATE.activeTransaction] = null
        this.clear()
      }
    )

    return this[PRIVATE.activeTransaction]
  }

  /**
   * The methods starts a new transaction and executes the provided callback
   * within it. The method waits for the operations started by the callback to
   * finish, then commits the transaction and resolves to the value returned by
   * the promise returned by the provided operations callback.
   *
   * Note that multiple simultaneous transactions cannot be started from the
   * same entity manager. The transaction will lock all object stores in the
   * database until the transaction completes.
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
      return transaction.abort().catch((abortError) => {
        if (abortError && (abortError.name === "AbortError")) {
          return // transaction successfully aborted
        }

        console.error("Encountered an unexpected error while trying to " +
            "abort a transaction due to an error", abortError)
      }).then(() => {
        throw error
      })
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
    if (!(entity instanceof AbstractEntity)) {
      throw new TypeError("The entity must be an AbstractEntity instance, " +
          `${entity} provided`)
    }
    let entityClass = entity.constructor
    validateEntityClass(entityClass)

    if (!this[PRIVATE.entities].has(entityClass)) {
      return // the entity is not managed by this entity manager, so we're done
    }

    let entities = this[PRIVATE.entities].get(entityClass)
    let keyPath = this[PRIVATE.entityKeyPaths].get(entityClass.objectStore)

    let primaryKey = getPrimaryKey(entity, keyPath)
    let serializedKey = serializeKey(primaryKey)
    entities.delete(serializedKey)
  }

  /**
   * Merges the state of the provided entity into the persistence context of
   * this entity manager.
   *
   * This method can be used only within a transaction because merging an
   * entity into the persistence context would have no effect outside a
   * transaction.
   *
   * @template {T} extends AbstractEntity
   * @param {T} entity The entity to merge into the persistence context.
   * @return {T} An entity managed by this entity manager, with its state set
   *         to a clone of the provided entity.
   */
  merge(entity) {
    if (!(entity instanceof AbstractEntity)) {
      throw new TypeError("The entity must an AbstractEntity instance")
    }
    var entityClass = entity.constructor
    validateEntityClass(entityClass)

    if (!this[PRIVATE.activeTransaction]) {
      throw new Error("There is no transaction active on this entity " +
          "manager, merging an entity into the persistence context would " +
          "not have any effect.")
    }

    if (this.contains(entity)) {
      return entity // nothing to do
    }

    if (!this[PRIVATE.entityKeyPaths].has(entityClass.objectStore)) {
      throw new Error(`The object store (${entityClass.objectStore}) of the ` +
          "provided entity does not exist")
    }

    let keyPath = this[PRIVATE.entityKeyPaths].get(entityClass.objectStore)
    let primaryKey = getPrimaryKey(entity, keyPath)

    if (!this.containsByPrimaryKey(entityClass, primaryKey)) {
      return this[PRIVATE.manage](entityClass, keyPath, entity, true)
    }

    let entityClone = clone(entity)
    let managedEntity = this[PRIVATE.manage](
      entityClass,
      keyPath,
      entityClone // prevent conflict in persistence context
    )
    Object.assign(managedEntity, entityClone)

    return managedEntity
  }

  /**
   * Reloads the state of the provided entity from the database. The entity
   * will be modified in place asynchronously.
   *
   * @template {T} extends AbstractEntity
   * @param {T} entity The entity that should have its state reloaded. The
   *        entity does not have to be currently managed by this entity
   *        manager.
   * @return {Promise<T>} A promise that resolves to the reloaded entity.
   */
  refresh(entity) {
    if (!(entity instanceof AbstractEntity)) {
      throw new TypeError("The entity must an AbstractEntity instance")
    }
    let entityClass = entity.constructor
    validateEntityClass(entityClass)

    let storeName = entityClass.objectStore
    let keyPath
    let primaryKey
    if (this[PRIVATE.rwTransactionRunner]) {
      return this[PRIVATE.runTransactionOperation]((transaction) => {
        let objectStore = transaction.getObjectStore(storeName)
        keyPath = objectStore.keyPath
        primaryKey = getPrimaryKey(entity, keyPath)
        return objectStore.get(primaryKey)
      }).then(processRefreshedData.bind(this))
    }

    return this[PRIVATE.connection].then((database) => {
      return database.runReadOnlyTransaction(storeName, (objectStore) => {
        keyPath = objectStore.keyPath
        primaryKey = getPrimaryKey(entity, keyPath)
        return objectStore.get(primaryKey)
      })
    }).then(processRefreshedData.bind(this))

    function processRefreshedData(entityData) {
      if (!this[PRIVATE.entities].has(entityClass)) {
        this[PRIVATE.entities].set(entityClass, new Map())
      }

      let entities = this[PRIVATE.entities].get(entityClass)
      let serializedKey = serializeKey(primaryKey)
      entities.set(serializedKey, {
        data: clone(entityData),
        entity
      })

      Object.assign(entity, entityData)
      this[PRIVATE.deleteExtraneousFields](entity, entityData)
      return entity
    }
  }

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
   * @param {(Object<string, *>|T)} entityData The record containing the data
   *        from which the entity should be constructed, or an existing entity
   *        to manage.
   * @param {boolean=} foreignEntity Whether the entity is foreign (its state
   *        in the database is not known).
   * @return {T} The already managed entity or a newly created managed entity
   *         created out of the provided data.
   */
  [PRIVATE.manage](entityClass, keyPath, entityData, foreignEntity = false) {
    if (!this[PRIVATE.entities].has(entityClass)) {
      this[PRIVATE.entities].set(entityClass, new Map())
    }

    let entities = this[PRIVATE.entities].get(entityClass)
    let entity
    if (entityData instanceof AbstractEntity) {
      entity = entityData
    } else {
      entity = new entityClass(entityData)
    }
    let primaryKey = getPrimaryKey(entity, keyPath)
    let serializedKey = serializeKey(primaryKey)

    if (entities.has(serializedKey)) {
      if (entityData instanceof AbstractEntity) {
        // this shouldn't happen, but just in case...
        throw new Error("It appears an attempt was made to add multiple " +
            "instances of the same entity into the persistence context of a " +
            "single entity manager. This is a persistence conflict and the " +
            "latter entity will be rejected. To merge the state of these " +
            "entities into a single persistence context, use the merge() " +
            "method instead.")
      }
      return entities.get(serializedKey).entity
    }

    let entry = {
      data: clone(entityData),
      entity
    }
    if (foreignEntity) {
      entry.foreign = true
    }
    entities.set(serializedKey, entry)

    return entity
  }

  /**
   * Runs the provided transaction in the current read-write transaction and
   * returns a promise that resolves when the operation completes.
   *
   * @template T
   * @param {function(Transaction): (Promise<T>|PromiseSync<T>)} operation The
   *        operation to run.
   * @return {Promise<T>} A promise that resolves to the operation's result.
   */
  [PRIVATE.runTransactionOperation](operation) {
    if (!this[PRIVATE.rwTransactionRunner]) {
      throw new Error("There is no transaction in progress")
    }

    return this[PRIVATE.rwTransactionRunner].then((transactionRunner) => {
      return new Promise((resolve, reject) => {
        transactionRunner.queueOperation((transaction) => {
          try {
            operation(transaction).then(resolve).catch(reject)
          } catch (error) {
            reject(error)
          }
        })
      })
    })
  }

  /**
   * Deletes all fields from the target object that are not present in the mask
   * object.
   *
   * @param {Object<string, *>} target The object that should have its fields
   *        filtered according to the mask.
   * @param {Object<string, *>} mask An object that acts as a mask, specifying
   *        which fields are allowed in the target.
   */
  [PRIVATE.deleteExtraneousFields](target, mask) {
    for (let fieldName of Object.keys(target)) {
      if (mask.hasOwnProperty(fieldName)) {
        continue
      }

      delete target[fieldName]
    }
  }
}
