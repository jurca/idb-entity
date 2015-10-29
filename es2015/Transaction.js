
import {
  validateEntityClass,
  getPrimaryKey,
  setPrimaryKey,
  serializeKey,
  clone,
  equals
} from "./utils"

/**
 * Private field and method symbols.
 *
 * @type {Object<string, symbol>}
 */
const PRIVATE = Object.freeze({
  // fields
  entityManager: Symbol("entityManager"),
  entities: Symbol("entities"),
  manageEntity: Symbol("manageEntity"),
  completionCallback: Symbol("completionCallback"),
  pendingOperations: Symbol("pendingOperations"),
  transaction: Symbol("transaction"),
  active: Symbol("active"),
  aborted: Symbol("aborted"),

  // methods
  initTransactionRunner: Symbol("initTransactionRunner"),
  executedPendingOperations: Symbol("executedPendingOperations"),
  detachEntity: Symbol("detachEntity")
})

/**
 * An entity manager transaction allowing for executing a sequence of database
 * operations atomically.
 */
export default class Transaction {
  /**
   * Initializes the transaction.
   *
   * @param {EntityManager} entityManager The entity manager owning this
   *        transaction.
   * @param {Promise<Database>} connection The promise that will resolve to a
   *        connection to the database.
   * @param {Map<function(new: AbstractEntity, data: Object<string, *>), Map<string, {data: *, entity: AbstractEntity}>>} entities
   *        Registry of currently managed entities. The registry is a map of
   *        entity classes to a map of serialized entity primary keys to entity
   *        source data and entity instances.
   * @param {function(function(new: AbstractEntity, Object<string, *>), (string|string[]), Object<string, *>): AbstractEntity} manageEntity
   *        A callback provided by the entity manager to create a managed
   *        entity out of a record, or to retrieve an already managed entity
   *        representing the record.
   * @param {function()} completionCallback A callback provided by the entity
   *        manager to invoke one this transaction has been completed, either
   *        by committing, or aborting it.
   */
  constructor(entityManager, connection, entities, manageEntity,
      completionCallback) {
    /**
     * The entity manager owning this transaction.
     *
     * @type {EntityManager}
     */
    this[PRIVATE.entityManager] = entityManager

    /**
     * Registry of currently managed entities. The registry is a map of entity
     * classes to a map of serialized entity primary keys to entity source data
     * and entity instances.
     *
     * @type {Map<function(new: AbstractEntity, data: Object<string, *>), Map<string, {data: *, entity: AbstractEntity}>>}
     */
    this[PRIVATE.entities] = entities

    /**
     * A callback provided by the entity manager to create a managed entity out
     * of a record, or to retrieve an already managed entity representing the
     * record.
     *
     * @template {T} extends AbstractEntity
     * @type {function(function(new: T, Object<string, *>), (string|string[]), Object<string, *>): T}
     */
    this[PRIVATE.manageEntity] = manageEntity

    /**
     * A callback provided by the entity manager to invoke one this transaction
     * has been completed, either by committing, or aborting it.
     *
     * @type {function()}
     */
    this[PRIVATE.completionCallback] = completionCallback

    /**
     * A flag signalling whether the transaction is still active.
     *
     * @type {boolean}
     */
    this[PRIVATE.active] = true

    /**
     * A flag signalling whether the transaction has been aborted.
     *
     * @type {boolean}
     */
    this[PRIVATE.aborted] = false

    /**
     * The operations scheduled to be executed in this transaction as soon as
     * the keep-alive operation is resolved.
     *
     * @type {function(Transaction)[]}
     */
    this[PRIVATE.pendingOperations] = []

    connection.then((database) => {
      this[PRIVATE.initTransactionRunner](database)
    })
  }

  /**
   * Commits all changes done to the entities currently managed by the entity
   * manager that started this transaction, including the modifications made
   * BEFORE the transaction was started.
   *
   * @return {Promise<undefined>} A promise that will be resolved once the
   *         transaction has been committed.
   */
  commit() {
    if (!this[PRIVATE.active]) {
      throw new Error("The transaction is no longer active")
    }

    if (!this[PRIVATE.transaction]) {
      return new Promise((resolve) => {
        setTimeout(resolve, 0)
      }).then(() => this.commit())
    }

    // save the modified entities
    for (let entities of this[PRIVATE.entities].values()) {
      for (let {data, entity} of entities.values()) {
        if (equals(entity, data)) {
          continue // the entity has not been modified
        }

        this[PRIVATE.pendingOperations].push((transaction) => {
          let objectStoreName = entity.constructor.objectStore
          let objectStore = transaction.getObjectStore(objectStoreName)
          objectStore.put(entity)
        })
      }
    }

    this[PRIVATE.active] = false

    return this[PRIVATE.transaction].completionPromise.then(() => {
      // update the copy of persisted data in the entity manager
      for (let entities of this[PRIVATE.entities].values()) {
        for (let dataAndEntity of entities.values()) {
          dataAndEntity.data = clone(dataAndEntity.entity)
        }
      }

      this[PRIVATE.completionCallback]()
    })
  }

  /**
   * Aborts this transaction and reverts all changes done to the entities
   * managed by the entity managed owning this transaction, including the
   * changes done before this transaction has been started.
   *
   * @return {Promise<undefined>} A promise that will be REJECTED once the
   *         transaction has been aborted. The promise will never be resolved.
   */
  abort() {
    if (!this[PRIVATE.active]) {
      throw new Error("The transaction is no longer active")
    }

    if (!this[PRIVATE.transaction]) {
      return new Promise((resolve) => {
        setTimeout(resolve, 0)
      }).then(() => this.abort())
    }

    this[PRIVATE.active] = false
    this[PRIVATE.aborted] = true

    let unexpectedEnd = false
    this[PRIVATE.transaction].abort()
    return this[PRIVATE.transaction].completionPromise.then(() => {
      unexpectedEnd = true
      throw new Error("Unexpected transaction end. Has the transaction " +
          "been already committed?")
    }).catch((error) => {
      if (unexpectedEnd) {
        throw error
      }

      // we expect this error, it is a transaction abort error... at least
      // let's hope it is

      // let's revert any entity modifications
      for (let entities of this[PRIVATE.entities].values()) {
        for (let dataAndEntity of entities.values()) {
          let entity = dataAndEntity.entity;
          Object.assign(entity, clone(dataAndEntity.data))
        }
      }

      this[PRIVATE.completionCallback]()

      throw error
    })
  }

  /**
   * Creates the specified entity in the storage. If the entity does not have
   * its primary key set and the storage has the {@code autoIncrement} flag
   * set, the entity will have its primary key generated and set after this
   * operation completes.
   *
   * The created entity will be managed by this entity manager.
   *
   * @param {AbstractEntity} entity The entity to persist in the storage.
   * @return {Promise<AbstractEntity>} A promise that will resolve to the
   *         provided entity when the entity has been saved.
   */
  persist(entity) {
    if (!this[PRIVATE.active]) {
      throw new Error("The transaction is no longer active")
    }

    validateEntityClass(entity.constructor)
    let objectStoreName = entity.constructor.objectStore

    return new Promise((resolve, reject) => {
      this[PRIVATE.pendingOperations].push((transaction) => {
        try {
          let objectStore = transaction.getObjectStore(objectStoreName)
          let keyPath = objectStore.keyPath

          objectStore.add(entity).then((primaryKey) => {
            setPrimaryKey(entity, keyPath, primaryKey)
            resolve(entity)
          }).catch(reject)
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  /**
   * Deletes the specified entity.
   *
   * @param {function(new: AbstractEntity, Object<string, *>)} entityClass The
   *        entity class specifying the type of the entity to delete.
   * @param {(number|string|Date|Array)} primaryKey The primary key identifying
   *        the entity to delete.
   * @return {Promise<undefined>} A promise that resolves when the record has
   *         been deleted.
   */
  remove(entityClass, primaryKey) {
    if (!this[PRIVATE.active]) {
      throw new Error("The transaction is no longer active")
    }

    validateEntityClass(entityClass)
    let objectStoreName = entityClass.objectStore

    return new Promise((resolve, reject) => {
      this[PRIVATE.pendingOperations].push((transaction) => {
        try {
          let objectStore = transaction.getObjectStore(objectStoreName)

          objectStore.delete(primaryKey).then(resolve).catch(reject)
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  /**
   * Executes an update query for batch update of entities matched by the
   * specified query.
   *
   * Note that the entities matched by this query will become managed by the
   * entity managed owning this transaction, unless they are already managed by
   * it.
   *
   * @template {T} extends AbstractEntity
   * @param {function(new: T, Object<string, *>)} entityClass The entity class
   *        specifying the type of entity to match by the query.
   * @param {?(undefined|number|string|Date|Array|IDBKeyRange|Object<string, (number|string|Date|Array|IDBKeyRange)>|function(*, (number|string|Date|Array)): boolean)=} filter
   *        The filter, restricting the entities updated by this method. If a
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
   * @return {function(function(T)): Promise<number>} A factory function that
   *         accepts a callback that will be executed on each entity matched by
   *         this query. The modifications made by the callback will be saved.
   *         The factory function returns a promise that will resolve once all
   *         entities have been processed. The promise resolves to the number
   *         of updated entities.
   */
  updateQuery(entityClass, filter = null, order = "next", offset = 0,
      limit = null) {
    if (!this[PRIVATE.active]) {
      throw new Error("The transaction is no longer active")
    }

    validateEntityClass(entityClass)
    let objectStoreName = entityClass.objectStore

    return (entityCallback) => {
      return new Promise((resolve, reject) => {
        this[PRIVATE.pendingOperations].push((transaction) => {
          try {
            let objectStore = transaction.getObjectStore(objectStoreName)
            let keyPath = objectStore.keyPath

            objectStore.updateQuery(filter, order, offset, limit)((record) => {
              let entity = this[PRIVATE.manageEntity](
                entityClass,
                keyPath,
                record
              )

              entityCallback(entity)

              return entity
            }).then(resolve).catch(reject)
          } catch (error) {
            reject(error)
          }
        })
      })
    }
  }

  /**
   * Executes a delete query, deleting all entities matched by the specified
   * query.
   *
   * @param {function(new: AbstractEntity, Object<string, *>)} entityClass The
   *        entity class specifying the type of entity to match by the query.
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
    if (!this[PRIVATE.active]) {
      throw new Error("The transaction is no longer active")
    }

    validateEntityClass(entityClass)
    let objectStoreName = entityClass.objectStore

    return new Promise((resolve, reject) => {
      this[PRIVATE.pendingOperations].push((transaction) => {
        try {
          let objectStore = transaction.getObjectStore(objectStoreName)
          let keyPath = objectStore.keyPath

          objectStore.query(filter, order, offset, limit).then((records) => {
            Promise.all(records.map((record) => {
              let primaryKey = getPrimaryKey(record, keyPath)
              return objectStore.delete(primaryKey).then(() => {
                this[PRIVATE.entityManager].detach(entityClass, primaryKey)
              })
            })).then(resolve).catch(reject)
          }).catch(reject)
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  /**
   * Initializes the asynchronous runner of the operations in this transaction.
   * The runner will keep the transaction alive using keep-alive operations and
   * execute any pending operations every time the keep-alive operation
   * completes.
   *
   * The runner will terminate with running the remaining pending operations
   * once the {@code PRIVATE.active} flag is {@code false}
   *
   * @param {Database} database The indexed-db.es6 database in which this
   *        transaction is executed.
   */
  [PRIVATE.initTransactionRunner](database) {
    let transaction = database.startTransaction(database.objectStoreNames)
    this[PRIVATE.transaction] = transaction
    let objectStore = transaction.getObjectStore(database.objectStoreNames[0])

    keepAlive.call(this)

    function keepAlive() {
      this[PRIVATE.executedPendingOperations](transaction)

      objectStore.get(Number.MIN_SAFE_INTEGER).then(() => {
        if (this[PRIVATE.aborted]) {
          return
        }

        if (this[PRIVATE.active]) {
          keepAlive.call(this)
        } else {
          // finish pending operations
          this[PRIVATE.executedPendingOperations](transaction)
        }
      })
    }
  }

  /**
   * Executes all pending operations in this transaction.
   *
   * @param {Transaction} transaction The indexed-db.es transaction.
   */
  [PRIVATE.executedPendingOperations](transaction) {
    let operations = this[PRIVATE.pendingOperations]
    this[PRIVATE.pendingOperations] = []

    for (let operation of operations) {
      operation(transaction)
    }
  }

  /**
   * Detaches the entity identified by the provided primary key from the entity
   * manager that created this transaction.
   *
   * @param {function(new: AbstractEntity, data: Object<string, *>)} entityClass
   *        The entity class specifying the entity type.
   * @param {(number|string|Date|Array)} primaryKey The primary key identifying
   *        the entity.
   */
  [PRIVATE.detachEntity](entityClass, primaryKey) {
    let entities = this[PRIVATE.entities].get(entityClass)

    if (entities) {
      let serializedKey = serializeKey(primaryKey)
      entities.delete(serializedKey)
    }
  }
}
