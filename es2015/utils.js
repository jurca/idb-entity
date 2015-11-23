
import cloneImpl from "./clone"
import equalsImpl from "./equals"
import AbstractEntity from "./AbstractEntity"

/**
 * Clones the provided value using the structured clone algorithm.
 *
 * @param {*} value The value to clone.
 * @return {*} The created clone of the value.
 * @see https://developer.mozilla.org/en-US/docs/Web/Guide/API/DOM/The_structured_clone_algorithm
 * @see http://www.w3.org/html/wg/drafts/html/master/infrastructure.html#safe-passing-of-structured-data
 */
export let clone = cloneImpl

/**
 * Compares the provided values to determine whether they are equal.
 *
 * @param {*} value1 The 1st value to compare.
 * @param {*} value2 The 2nd value to compare.
 * @return {boolean} {@code true} if the values are equal.
 */
export let equals = equalsImpl

/**
 * Serializes the provided Indexed DB key to a string.
 *
 * @param {(number|string|Date|Array)} key The key to serialize.
 * @return {string} Serialized key.
 */
export function serializeKey(key) {
  switch (typeof key) {
    case "number":
    case "string":
      return JSON.stringify(key)
  }

  if (key instanceof Date) {
    return `Date(${key.valueOf()})`;
  }

  return key.map(keyPart => serializeKey(keyPart)).join(",")
}

/**
 * Retrieves the primary key from the provided entity.
 *
 * @param {AbstractEntity} entity The entity.
 * @param {(string|string[])} keyPath The primary key key path.
 * @return {(number|string|Date|Array)} The primary key of the entity.
 */
export function getPrimaryKey(entity, keyPath) {
  if (keyPath instanceof Array) {
    return keyPath.map(fieldPath => getField(entity, fieldPath))
  }
  
  return getField(entity, keyPath)
}

/**
 * Sets the primary key of the provided entity to the provided value.
 *
 * @param {AbstractEntity} entity The entity that should have its primary key
 *        set.
 * @param {(string|string[])} keyPath The primary key key path.
 * @param {(number|string|Date|Array)} primaryKey The primary key to set.
 */
export function setPrimaryKey(entity, keyPath, primaryKey) {
  if (keyPath instanceof Array) {
    let isPrimaryKeyValid = (primaryKey instanceof Array) &&
        (keyPath.length === primaryKey.length)
    if (!isPrimaryKeyValid) {
      throw new Error("The number of elements of the primary key array must " +
          "match the number of field paths in the key path")
    }
    
    for (let i = 0; i < keyPath.length; i++) {
      setField(entity, keyPath[i], primaryKey[i])
    }
  } else {
    setField(entity, keyPath, primaryKey)
  }
}

/**
 * Tests whether the provided class is a valid entity class. The function
 * throws an error if the class is invalid.
 *
 * @template {T} extends AbstractEntity
 * @param {function(new: T, data: Object<string, *>)} entityClass
 * @throws {Error} Thrown if the provided class extends the
 *         {@linkcode AbstractEntity} class, but does not define the static
 *         {@code objectStore} property.
 * @throws {TypeError} Thrown if the provided class does not extend the
 *         {@linkcode AbstractEntity} class.
 */
export function validateEntityClass(entityClass) {
  if (!isSubClass(entityClass, AbstractEntity)) {
    throw new TypeError("The provided class must be an entity class - it " +
      "must extend the AbstractEntity class")
  }

  if (!specifiesObjectStore(entityClass)) {
    throw new Error("The entity class must specify the objectStore property " +
      "that returns a non-empty string specifying the name of the object " +
      "store")
  }
}

/**
 * Tests whether the specified sub-class extends the specified super-class.
 * Note that according to this function, any class is its own sub-class and
 * super-class.
 *
 * @param {function(new: *)} subClass The sub-class to test.
 * @param {function(new: *)} superClass The super-class to test against.
 * @return {boolean} If the provided sub-class extends the specified
 *         super-class.
 */
export function isSubClass(subClass, superClass) {
  let prototype = subClass.prototype
  
  while (prototype) {
    if (prototype === superClass.prototype) {
      return true
    }
    
    prototype = Object.getPrototypeOf(prototype)
  }
  
  return false
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

/**
 * Returns the value of the field at the specified field path of the provided
 * object.
 *
 * @param {Object} object The object from which the field path value should be
 *        extracted.
 * @param {string} fieldPath The path to the field from which the value should
 *        be returned. The field path must be a sequence of valid ECMAScript
 *        identifiers separated by dots.
 * @return {*} The value of the field at the specified field path.
 */
function getField(object, fieldPath) {
  let currentObject = object
  
  for (let fieldName of fieldPath.split(".")) {
    if (!currentObject.hasOwnProperty(fieldName)) {
      return undefined
    }
    
    currentObject = currentObject[fieldName]
  }
  
  return currentObject
}

/**
 * Sets the field at the specified field path to the provided value in the
 * provided object.
 *
 * The function creates the field path out of empty plain objects if it does
 * not already exist.
 *
 * @param {Object} object The object in which the specified field path should
 *        be set to the provided value.
 * @param {string} fieldPath The field path at which the value should be set.
 *        The field path must be a sequence of valid ECMAScript identifiers
 *        separated by dots.
 * @param {*} value The value to set.
 */
function setField(object, fieldPath, value) {
  let currentObject = object
  let fieldNames = fieldPath.split(".")
  
  for (let fieldName of fieldNames.slice(0, -1)) {
    if (!currentObject.hasOwnProperty(fieldName)) {
      currentObject[fieldName] = {}
    }
    
    currentObject = currentObject[fieldName]
  }
  
  currentObject[fieldNames.pop()] = value
}
