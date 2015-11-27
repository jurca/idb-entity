
/**
 * The {@linkcode AbstractEntity} is a base class of all entity classes - all
 * entities managed by an entity manager must be instances of classes extending
 * this one.
 *
 * A class extending the {@linkcode AbstractEntity} class must also specify a
 * static {@code objectStore} property that returns a string. The returned
 * string specifies the name of the IndexedDB object store in which the
 * entities are to be stored. Object stores must not be shared among entity
 * classes.
 *
 * @abstract
 */
export default class AbstractEntity {
  /**
   * Initializes the entity from the provided data.
   *
   * @param {Object<string, *>} data The data representing the state of the
   *        entity. The data may contain cyclic references except for
   *        references to the data object itself.
   */
  constructor(data) {
    if (new.target === AbstractEntity) {
      throw new Error("The AbstractEntity class is abstract and must be " +
          "overridden")
    }
    if (!specifiesObjectStore(this.constructor)) {
      throw new Error("The entity class must specify an objectStore " +
          "property that returns a non-empty string specifying the name of " +
          "the object store")
    }

    Object.assign(this, data)
  }
}

/**
 * Returns {@code true} if the provided entity class has a valid static
 * {@code objectStore} property that returns a non-empty string.
 *
 * @param {function(new: AbstractEntity, data: Object<string, *>)} entityClass
 *        The entity class to validate.
 * @return {boolean} {@code true} if the provided entity class has a valid
 *         static {@code objectStore} property.
 */
export function specifiesObjectStore(entityClass) {
  return entityClass.hasOwnProperty("objectStore") &&
    (typeof entityClass.objectStore === "string") &&
    !!entityClass.objectStore
}
