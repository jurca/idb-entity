
import {
  validateEntityClass,
  getPrimaryKey,
  setPrimaryKey,
  serializeKey,
  clone,
  equals
} from "./utils"
import WriteOperationsProvider from "./WriteOperationsProvider"

/**
 * Private field and method symbols.
 *
 * @type {Object<string, symbol>}
 */
const PRIVATE = Object.freeze({
  // fields
  entityManager: Symbol("entityManager"),
  transactionRunnerPromise: Symbol("transactionRunnerPromise"),
  transactionRunner: Symbol("transactionRunner"),
  entities: Symbol("entities"),
  manageEntity: Symbol("manageEntity"),
  completionCallback: Symbol("completionCallback"),
  active: Symbol("active"),

  // methods
  getOperationsProvider: Symbol("getOperationsProvider"),
  runOperation: Symbol("runOperation")
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
   * @param {Promise<TransactionRunner>} transactionRunnerPromise The promise
   *        that will resolve to a transaction runner for this transaction.
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
  constructor(entityManager, transactionRunnerPromise, entities, manageEntity,
      completionCallback) {
    /**
     * The entity manager owning this transaction.
     *
     * @type {EntityManager}
     */
    this[PRIVATE.entityManager] = entityManager

    /**
     * The promise that will resolve to a transaction runner for this
     * transaction.
     *
     * @type {Promise<TransactionRunner>}
     */
    this[PRIVATE.transactionRunnerPromise] = transactionRunnerPromise

    /**
     * The current transaction runner keeping the transaction alive as long as
     * necessary and executing the operations. The field will be set once the
     * {@code transactionRunnerPromise} private field is set.
     *
     * @type {?TransactionRunner}
     */
    this[PRIVATE.transactionRunner] = null

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
     * Flag signalling whether the transaction is still active.
     *
     * @type {boolean}
     */
    this[PRIVATE.active] = true

    transactionRunnerPromise.then((transactionRunner) => {
      this[PRIVATE.transactionRunner] = transactionRunner
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

    this[PRIVATE.active] = false

    if (!this[PRIVATE.transactionRunner]) {
      return this[PRIVATE.transactionRunnerPromise].then(() => {
        this[PRIVATE.active] = true
        return this.commit()
      })
    }

    if (!this[PRIVATE.transactionRunner].isActive) {
      throw new Error("The transaction is no longer active")
    }

    // save the modified entities
    for (let entities of this[PRIVATE.entities].values()) {
      for (let {data, entity} of entities.values()) {
        if (equals(entity, data)) {
          continue // the entity has not been modified
        }

        this[PRIVATE.transactionRunner].queueOperation((transaction) => {
          let objectStoreName = entity.constructor.objectStore
          let objectStore = transaction.getObjectStore(objectStoreName)
          objectStore.put(entity)
        })
      }
    }

    return this[PRIVATE.transactionRunner].commit().then(() => {
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

    this[PRIVATE.active] = false

    if (!this[PRIVATE.transactionRunner]) {
      return this[PRIVATE.transactionRunnerPromise].then(() => {
        this[PRIVATE.active] = true
        return this.abort()
      })
    }

    if (!this[PRIVATE.transactionRunner].isActive) {
      throw new Error("The transaction is no longer active")
    }

    return this[PRIVATE.transactionRunner].abort().then(() => {
      throw new Error("Unexpected transaction end. Has the transaction " +
          "been already committed?")
    }).catch((error) => {
      if (error.name !== "AbortError") {
        throw error
      }

      // we expect this error, it is a transaction abort error... at least
      // let's hope it is

      // let's revert any entity modifications
      for (let entities of this[PRIVATE.entities].values()) {
        for (let dataAndEntity of entities.values()) {
          let entity = dataAndEntity.entity
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

    return this[PRIVATE.runOperation]((operationsProvider) => {
      return operationsProvider.persist(entity)
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

    return this[PRIVATE.runOperation]((operationsProvider) => {
      return operationsProvider.remove(entityClass, primaryKey)
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

    return (entityCallback) => {
      return this[PRIVATE.runOperation]((operationsProvider) => {
        return operationsProvider.updateQuery(
          entityClass,
          filter,
          order,
          offset,
          limit,
          entityCallback
        )
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

    return this[PRIVATE.runOperation]((operationsProvider) => {
      return operationsProvider.deleteQuery(
        entityClass,
        filter,
        order,
        offset,
        limit
      )
    })
  }

  /**
   * Runs the provided write operation within this transaction, wrapped in a
   * promise.
   *
   * @template R
   * @param {function(WriteOperationsProvider): (Promise<R>|PromiseSync<R>)} operation
   *        The operation to execute.
   * @return {Promise<R>} A promise resolved when the operation has completed.
   */
  [PRIVATE.runOperation](operation) {
    if (!this[PRIVATE.transactionRunner]) {
      return this[PRIVATE.transactionRunnerPromise].then(() => {
        return this[PRIVATE.runOperation](operation)
      })
    }

    return new Promise((resolve, reject) => {
      this[PRIVATE.transactionRunner].queueOperation((transaction) => {
        try {
          let provider = this[PRIVATE.getOperationsProvider](transaction)
          operation(provider).then(resolve).catch(reject)
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  /**
   * Creates a provider of the write operations for the provided transaction.
   *
   * @param {Transaction} transaction The current indexed-db.es6 read-write
   *        transaction to use to perform the read-write operations.
   * @return {WriteOperationsProvider} The provider of write operations on the
   *         provided transaction.
   */
  [PRIVATE.getOperationsProvider](transaction) {
    return new WriteOperationsProvider(
      transaction,
      this[PRIVATE.manageEntity],
      this[PRIVATE.entityManager]
    )
  }
}
