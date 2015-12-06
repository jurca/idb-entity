
import AbstractEntity from "./AbstractEntity"

/**
 * Types of the typed array supported in the current environment.
 * 
 * @type {function(new: TypedArray)[]}
 */
const TYPED_ARRAY_TYPES = []

/**
 * Clones the provided value using the structured clone algorithm.
 * 
 * @param {*} value The value to clone.
 * @return {*} The created clone of the value.
 * @see https://developer.mozilla.org/en-US/docs/Web/Guide/API/DOM/The_structured_clone_algorithm
 * @see http://www.w3.org/html/wg/drafts/html/master/infrastructure.html#safe-passing-of-structured-data
 */
export default function clone(value) {
  return cloneValue(value, new Map())
}

/**
 * Clones the provided value using the structured clone algorithm.
 * 
 * @param {*} value The value to clone.
 * @param {Map<Object, Object>} traversedValues A map of traversed
 *        non-primitive keys and values. The keys are the keys and values
 *        traversed in the source structure or structures referencing this
 *        structure, the values are the clones of the keys and values.
 * @return {*} The value clone.
 */
function cloneValue(value, traversedValues) {
  if (!(value instanceof Object)) {
    return value
  }
  
  if (value instanceof Boolean) {
    return new Boolean(value.valueOf())
  }

  if (value instanceof Number) {
    return new Number(value.valueOf())
  }
  
  if (value instanceof String) {
    return new String(value.valueOf())
  }
  
  if (value instanceof Date) {
    return new Date(value.valueOf())
  }
  
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags)
  }
  
  if ((typeof Blob === "function") && (value instanceof Blob)) {
    return value // immutable
  }
  
  if ((typeof File === "function") && (value instanceof File)) {
    return value // immutable
  }
  
  if ((typeof FileList === "function") && (value instanceof FileList)) {
    return value // immutable
  }
  
  if ((typeof ArrayBuffer === "function") && (value instanceof ArrayBuffer)) {
    return value.slice()
  }

  if ((typeof DataView === "function") && (value instanceof DataView)) {
    return new DataView(
      value.buffer.slice(),
      value.byteOffset,
      value.byteLength
    )
  }
  
  let isTypedArray = TYPED_ARRAY_TYPES.some(type => value instanceof type)
  if (isTypedArray) {
    return value.subarray()
  }
  
  if ((typeof ImageData === "function") && (value instanceof ImageData)) {
    return new ImageData(value.data, value.width, value.height)
  }

  if ((typeof ImageBitmap === "function") && (value instanceof ImageBitmap)) {
    return value
  }
  
  if (value instanceof Array) {
    return cloneArray(value, traversedValues)
  }
  
  if (value instanceof Map) {
    return cloneMap(value, traversedValues)
  }
  
  if (value instanceof Set) {
    return cloneSet(value, traversedValues)
  }

  if (isPlainObjectOrEntity(value)) {
    return cloneObject(value, traversedValues)
  }

  throw new Error(`Unsupported argument type: ${value}`)
}

/**
 * Clones the provided array.
 * 
 * @param {*[]} source The array to clone.
 * @param {Map<Object, Object>} traversedValues A map of traversed
 *        non-primitive keys and values. The keys are the keys and values
 *        traversed in the source structure or structures referencing this
 *        structure, the values are the clones of the keys and values.
 * @return {*[]} Source array clone.
 */
function cloneArray(source, traversedValues) {
  let clone = []
  traversedValues.set(source, clone)
  
  cloneStructure(
    source.keys(),
    key => source[key],
    (key, value) => clone[key] = value,
    traversedValues
  )
  
  return clone
}

/**
 * Clones the provided map.
 * 
 * @param {Map<*, *>} source The map to clone.
 * @param {Map<Object, Object>} traversedValues A map of traversed
 *        non-primitive keys and values. The keys are the keys and values
 *        traversed in the source structure or structures referencing this
 *        structure, the values are the clones of the keys and values.
 * @return {Map<*, *>} Source map clone.
 */
function cloneMap(source, traversedValues) {
  let clone = new Map()
  traversedValues.set(source, clone)
  
  cloneStructure(
    source.keys(),
    key => source.get(key),
    (key, value) => clone.set(key, value),
    traversedValues
  )
  
  return clone
}

/**
 * Clones the provided set.
 * 
 * @param {Set<*>} source The set to clone.
 * @param {Map<Object, Object>} traversedValues A map of traversed
 *        non-primitive keys and values. The keys are the keys and values
 *        traversed in the source structure or structures referencing this
 *        structure, the values are the clones of the keys and values.
 * @return {Set<*>} Source set clone.
 */
function cloneSet(source, traversedValues) {
  let clone = new Set()
  traversedValues.set(source, clone)
  
  cloneStructure(
    source.values(),
    entry => undefined,
    entry => clone.add(entry),
    traversedValues
  )
  
  return clone
}

/**
 * Clones the provided plain object. Symbol and prototype properties are not
 * copied.
 * 
 * @param {Object<string, *>} source The object to clone.
 * @param {Map<Object, Object>} traversedValues A map of traversed
 *        non-primitive keys and values. The keys are the keys and values
 *        traversed in the source structure or structures referencing this
 *        structure, the values are the clones of the keys and values.
 * @return {Object<string, *>} Source object clone.
 */
function cloneObject(source, traversedValues) {
  let clone = {}
  traversedValues.set(source, clone)
  
  cloneStructure(
    Object.keys(source),
    key => source[key],
    (key, value) => clone[key] = value,
    traversedValues
  )
  
  return clone
}

/**
 * Clones the structure having the specified property keys, using the provided
 * getters and setters. The function clones the keys and values before setting
 * them using the setters.
 * 
 * The cloned structure may contain circular references, the function keeps
 * track of those using the {@code traversedValues} map.
 * 
 * @param {(*[]|{[Symbol.iterator]: function(): {next: function(): *}})} keys
 *        The keys or iterator or iterable object generating the keys to
 *        properties to clone.
 * @param {function(*): *} getter A callback that returns the value of the
 *        source structure for the provided key.
 * @param {function(*, *)} setter A callback that sets the provided value (2nd
 *        argument) to the property identified by the specified key (1st
 *        argument) in the structure clone.
 * @param {Map<Object, Object>} traversedValues A map of traversed
 *        non-primitive keys and values. The keys are the keys and values
 *        traversed in the source structure or structures referencing this
 *        structure, the values are the clones of the keys and values.
 */
function cloneStructure(keys, getter, setter, traversedValues) {
  for (let key of keys) {
    let value = getter(key)
    let keyClone
    
    if (key instanceof Object) {
      if (traversedValues.has(key)) {
        keyClone = traversedValues.get(key)
      } else {
        keyClone = cloneValue(key, traversedValues)
        traversedValues.set(key, keyClone)
      }
    } else {
      keyClone = key
    }
    
    if (value instanceof Object) {
      if (traversedValues.has(value)) {
        setter(keyClone, traversedValues.get(value))
      } else {
        let clonedValue = cloneValue(value, traversedValues)
        traversedValues.set(value, clonedValue)
        setter(keyClone, clonedValue)
      }
    } else {
      setter(keyClone, value)
    }
  }
}

/**
 * Returns {@code true} if the provided value is a plain object.
 *
 * @param {*} value The value to test.
 * @returns {boolean} {@code} if the provided value is a plain object or an
 *          entity.
 */
function isPlainObjectOrEntity(value) {
  return (value instanceof AbstractEntity) || (
        (value instanceof Object) &&
        (
          (Object.getPrototypeOf(value) === Object.prototype) ||
          (Object.getPrototypeOf(value) === null)
        )
      )
}

if (typeof Int8Array === "function") {
  TYPED_ARRAY_TYPES.push(Int8Array)
}
if (typeof Uint8Array === "function") {
  TYPED_ARRAY_TYPES.push(Uint8Array)
}
if (typeof Uint8ClampedArray === "function") {
  TYPED_ARRAY_TYPES.push(Uint8ClampedArray)
}
if (typeof Int16Array === "function") {
  TYPED_ARRAY_TYPES.push(Int16Array)
}
if (typeof Uint16Array === "function") {
  TYPED_ARRAY_TYPES.push(Uint16Array)
}
if (typeof Int32Array === "function") {
  TYPED_ARRAY_TYPES.push(Int32Array)
}
if (typeof Uint32Array === "function") {
  TYPED_ARRAY_TYPES.push(Uint32Array)
}
if (typeof Float32Array === "function") {
  TYPED_ARRAY_TYPES.push(Float32Array)
}
if (typeof Float64Array === "function") {
  TYPED_ARRAY_TYPES.push(Float64Array)
}
