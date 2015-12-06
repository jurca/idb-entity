
import {validateEntityClass, setPrimaryKey, getPrimaryKey} from "./utils"
import AbstractEntity from "./AbstractEntity"

/**
 * Private field and method symbols.
 *
 * @type {Object<string, symbol>}
 */
const PRIVATE = Object.freeze({
  transaction: Symbol("transaction"),
  manageEntity: Symbol("manageEntity"),
  entityManager: Symbol("entityManager")
})

/**
 * The Write Operations Provider is a shared implementation of entity
 * modification operations.
 */
export default class WriteOperationsProvider {
  /**
   * Initializes the provider of the read-write operations for the persistence
   * context.
   *
   * @param {Transaction} transaction The current indexed-db.es6 read-write
   *        transaction to use to perform the read-write operations.
   * @param {function(function(new: AbstractEntity, Object<string, *>), (string|string[]), Object<string, *>): AbstractEntity} manageEntity
   *        A callback, provided by the entity manager, used to create a
   *        managed entity out of a record, or to retrieve an already managed
   *        entity representing the record.
   * @param {EntityManager} entityManager The entity manager representing the
   *        persistence context within which this write operations provider
   *        will be used.
   */
  constructor(transaction, manageEntity, entityManager) {
    /**
     * The current indexed-db.es6 read-write transaction to use to perform the
     * read-write operations.
     *
     * @type {Transaction}
     */
    this[PRIVATE.transaction] = transaction

    /**
     * A callback, provided by the entity manager, used to create a managed
     * entity out of a record, or to retrieve an already managed entity
     * representing the record.
     *
     * @type {function(function(new:AbstractEntity, Object.<string, *>), (string|string[]), Object.<string, *>): AbstractEntity}
     */
    this[PRIVATE.manageEntity] = manageEntity

    /**
     * The entity manager representing the persistence context within which
     * this write operations provider will be used.
     *
     * @type {EntityManager}
     */
    this[PRIVATE.entityManager] = entityManager
  }

  /**
   * Creates the specified entity in the storage. If the entity does not have
   * its primary key set and the storage has the {@code autoIncrement} flag
   * set, the entity will have its primary key generated and set after this
   * operation completes.
   *
   * @param {AbstractEntity} entity The entity to persist in the storage.
   * @return {Promise<AbstractEntity>} A promise resolved when the entity has
   *         been persisted. The result is the persisted entity with its
   *         primary key set.
   */
  persist(entity) {
    if (!(entity instanceof AbstractEntity)) {
      throw new TypeError("The entity must be an AbstractEntity instance")
    }
    validateEntityClass(entity.constructor)

    let objectStoreName = entity.constructor.objectStore
    let objectStore = this[PRIVATE.transaction].getObjectStore(objectStoreName)
    let keyPath = objectStore.keyPath

    return new Promise((resolve, reject) => {
      objectStore.add(entity).then((primaryKey) => {
        setPrimaryKey(entity, keyPath, primaryKey)
        return entity
      }).then(resolve).catch(reject)
    }).then((entity) => {
      if (entity) {
        return this[PRIVATE.manageEntity](entity.constructor, keyPath, entity)
      }

      return null
    })
  }

  /**
   * Deletes the specified entity. If the specified entity is present in the
   * persistence context, it will be detached after being deleted.
   *
   * @param {function(new: AbstractEntity, Object<string, *>)} entityClass The
   *        entity class specifying the type of the entity to delete.
   * @param {(number|string|Date|Array)} primaryKey The primary key identifying
   *        the entity to delete.
   * @return {Promise<undefined>} A promise that resolves when the record has
   *         been deleted.
   */
  remove(entityClass, primaryKey) {
    validateEntityClass(entityClass)

    let objectStoreName = entityClass.objectStore
    let objectStore = this[PRIVATE.transaction].getObjectStore(objectStoreName)

    return new Promise((resolve, reject) => {
      objectStore.delete(primaryKey).then(resolve).catch(reject)
    }).then(() => {
      let entityManager = this[PRIVATE.entityManager]
      if (entityManager.containsByPrimaryKey(entityClass, primaryKey)) {
        let entity = entityManager.find(entityClass, primaryKey)
        entityManager.detach(entity)
      }
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
   * @param {function(T)} entityCallback A callback that will be executed on
   *        each entity matched by this query. The modifications made by the
   *        callback will be saved.
   * @return {Promise<number>} A promise that will resolve once all entities
   *         have been processed. The promise resolves to the number of updated
   *         entities.
   */
  updateQuery(entityClass, filter, order, offset, limit, entityCallback) {
    validateEntityClass(entityClass)

    let objectStoreName = entityClass.objectStore
    let objectStore = this[PRIVATE.transaction].getObjectStore(objectStoreName)
    let keyPath = objectStore.keyPath

    return new Promise((resolve, reject) => {
      objectStore.updateQuery(filter, order, offset, limit)((record) => {
        let entity = this[PRIVATE.manageEntity](
          entityClass,
          keyPath,
          record
        )

        entityCallback(entity)

        return entity
      }).then(resolve).catch(reject)
    })
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
  deleteQuery(entityClass, filter, order, offset, limit) {
    validateEntityClass(entityClass)

    let objectStoreName = entityClass.objectStore
    let objectStore = this[PRIVATE.transaction].getObjectStore(objectStoreName)
    let keyPath = objectStore.keyPath

    return new Promise((resolve, reject) => {
      let queryPromise = objectStore.query(
        filter,
        order,
        offset,
        limit
      ).then((records) => {
        // Since we have no guarantee under what module path the
        // indexed-db.es6's PromiseSync class will be available, we have to
        // obtain a reference to it like this
        const PromiseSync = queryPromise.constructor
        return PromiseSync.all(records.map((record) => {
          let primaryKey = getPrimaryKey(record, keyPath)
          return objectStore.delete(primaryKey).then(() => {
            let entityManager = this[PRIVATE.entityManager]
            if (!entityManager.containsByPrimaryKey(entityClass, primaryKey)) {
              return
            }

            let entity = entityManager.find(entityClass, primaryKey)
            entityManager.detach(entity)
          })
        }))
      }).then(resolve).catch(reject)
    })
  }
}
