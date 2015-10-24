
/**
 * Compares the provided values to determine whether they are equal.
 * 
 * @param {*} value1 The 1st value to compare.
 * @param {*} value2 The 2nd value to compare.
 * @return {boolean} {@code true} if the values are equal.
 */
export default function (value1, value2) {
  return equals(value1, value2, new Map())
}

/**
 * Types of native type object wrappers.
 * 
 * @type {function(new: *)[]}
 */
const WRAPPED_TYPES = [Boolean, String, Date]

/**
 * Types of objects that cannot be inspected. Values of this type will be
 * compared by identity.
 * 
 * @type {function(new: *)[]}
 */
const UNINSPECTABLE_TYPES = []

/**
 * Types of the typed array supported in the current environment.
 * 
 * @type {function(new: TypedAray)[]}
 */
const TYPED_ARRAY_TYPES = []

/**
 * Compares the provided values to determine whether they are equal.
 * 
 * @param {*} value1 The 1st value to compare.
 * @param {*} value2 The 2nd value to compare.
 * @param {Map<Object, Object>} A map of non-primitive values traversed in the
 *        first structure to their equal counterparts in the second structure.
 * @return {boolean} {@code true} if the values are equal.
 */
function equals(value1, value2, traversedValues) {
  if (!(value1 instanceof Object)) {
    return value1 === value2
  }
  
  for (let wrappedType of WRAPPED_TYPES) {
    if (value1 instanceof wrappedType) {
      return (value2 instanceof wrappedType) &&
          (value1.valueOf() === value2.valueOf())
    }
  }
  
  if (value1 instanceof RegExp) {
    return (value2 instanceof RegExp) &&
        (value1.source === value2.source) &&
        (value2.flags === value2.flags)
  }
  
  for (let uninspectableType of UNINSPECTABLE_TYPES) {
    if (value1 instanceof uninspectableType) {
      return (value2 instanceof uninspectableType) &&
          (value1 === value2)
    }
  }
  
  if ((typeof ArrayBuffer === "function") && (value1 instanceof ArrayBuffer)) {
    return (value2 instanceof ArrayBuffer) &&
        equals(new Int16Array(value1), new Int16Array(value2), traversedValues)
  }
  
  for (let arrayType of TYPED_ARRAY_TYPES) {
    if (value1 instanceof arrayType) {
      return (value2 instanceof arrayType) &&
          arrayEquals(value1, value2, traversedValues)
    }
  }
  
  if ((typeof ImageData === "function") && (value1 instanceof ImageData)) {
    return (value2 instanceof ImageData) &&
        (value1.width === value2.width) &&
        (value1.height === value2.height) &&
        equals(value1.data, value2.data, traversedValues)
  }
  
  if (value1 instanceof Array) {
    return (value2 instanceof Array) &&
        arrayEquals(value1, value2, traversedValues)
  }
  
  if (value1 instanceof Map) {
    return setEquals(value1, value2, traversedValues)
  }
  
  if (value1 instanceof Set) {
    return setEquals(value1, value2, traversedValues)
  }
  
  return objectEquals(value1, value2, traversedValues)
}

/**
 * Compares the two provided plain objects.
 * 
 * @param {Object<string, *>} object1 The 1st object to compare.
 * @param {Object<string, *>} object2 The 2nd object to compare.
 * @param {Map<Object, Object>} A map of non-primitive values traversed in the
 *        first structure to their equal counterparts in the second structure.
 * @return {boolean} {@code true} if the objects are equal.
 */
function objectEquals(object1, object2, traversedValues) {
  let keys1 = Object.keys(object1)
  let keys2 = Object.keys(object2)
  
  return structureEquals(
    object1,
    object2,
    keys1,
    keys2,
    (object, key) => object[key],
    traversedValues
  )
}

/**
 * Compares the two provided sets.
 * 
 * @param {Set<*>} set1 The 1st set to compare.
 * @param {Set<*>} set2 The 2nd set to compare.
 * @param {Map<Object, Object>} A map of non-primitive values traversed in the
 *        first structure to their equal counterparts in the second structure.
 * @return {boolean} {@code true} if the sets are equal.
 */
function setEquals(set1, set2, traversedValues) {
  if (set1.size !== set2.size) {
    return false
  }
  
  return structureEquals(
    set1,
    set2,
    iteratorToArray(set1.values()),
    iteratorToArray(set2.values()),
    () => undefined,
    traversedValues
  )
}

/**
 * Compares the two provided maps.
 * 
 * @param {Map<*, *>} map1 The 1st map to compare.
 * @param {Map<*, *>} map2 The 2nd map to compare.
 * @param {Map<Object, Object>} A map of non-primitive values traversed in the
 *        first structure to their equal counterparts in the second structure.
 * @return {boolean} {@code true} if the maps are equal.
 */
function mapEquals(map1, map2, traversedValues) {
  if (map1.size !== map2.size) {
    return false
  }
  
  return structureEquals(
    map1,
    map2,
    iteratorToArray(map1.keys()),
    iteratorToArray(map2.keys()),
    (map, key) => map.get(key),
    traversedValues
  )
}

/**
 * Compares the two provided arrays.
 * 
 * @param {*[]} array1 The 1st array to compare.
 * @param {*[]} array2 The 2nd array to compare.
 * @param {Map<Object, Object>} A map of non-primitive values traversed in the
 *        first structure to their equal counterparts in the second structure.
 * @return {boolean} {@code true} if the arrays are equal.
 */
function arrayEquals(array1, array2, traversedValues) {
  if (array1.length !== array2.length) {
    return false
  }
  
  return structureEquals(
    array1,
    array2,
    iteratorToArray(array1.keys()),
    iteratorToArray(array2.keys()),
    (array, key) => array[key],
    traversedValues
  )
}

/**
 * Performs a structured comparison of two structures, determining their
 * equality.
 * 
 * @param {Object} structure1 The first structure to compare.
 * @param {Object} structure2 The second structure to compare.
 * @param {*[]} keys1 The keys of the properties to compare in the first
 *        structure.
 * @param {*[]} keys2 The keys of the properties to compare in the second
 *        structure.
 * @param {function(Object, *): *} getter A callback for retrieving the value
 *        of the property identified by the provided key (2nd argument) from
 *        the structure (1st argument).
 * @param {Map<Object, Object>} A map of non-primitive values traversed in the
 *        first structure to their equal counterparts in the second structure.
 * @return {boolean} {@code true} if the keys, the order of the keys and the
 *         values retrieved by the keys from the structures are equal.
 */
function structureEquals(structure1, structure2, keys1, keys2, getter,
    traversedValues) {
  if (keys1.length !== keys2.length) {
    return false
  }
  
  traversedValues.set(structure1, structure2)
      
  for (let i = keys1.length; i--;) {
    let key1 = keys1[i]
    let key2 = keys2[i]
    
    if ((key1 instanceof Object) && traversedValues.has(key1)) {
      if (traversedValues.get(key1) !== key2) {
        return false
      }
    }
    
    if (!equals(key1, key2, traversedValues)) {
      return false
    }
    
    if (key1 instanceof Object) {
      traversedValues.set(key1, key2)
    }
    
    let value1 = getter(structure1, key1)
    let value2 = getter(structure2, key2)
    
    if ((value1 instanceof Object) && traversedValues.has(key1)) {
      if (traversedValues.get(value1) !== value2) {
        return false
      }
    }
    
    if (!equals(value1, value2, traversedValues)) {
      return false
    }
    
    if (value1 instanceof Object) {
      traversedValues.set(value1, value2)
    }
  }
  
  return true
}

/**
 * Traverses the provided finite iterator or iterable object and returns an
 * array of generated values.
 * 
 * @param {({[Symbol.iterator]: function(): {next: function(): *}}|{next: function(): *)}
 *        iterator The iterator or iterable object.
 * @return {*[]} The elements generated by the iterator.
 */
function iteratorToArray(iterator) {
  let elements = []
  
  for (let element of iterator) {
    elements.push(element)
  }
  
  return elements
}

if (typeof Blob === "function") {
  UNINSPECTABLE_TYPES.push(Blob)
}
if (typeof File === "function") {
  UNINSPECTABLE_TYPES.push(File)
}
if (typeof FileList === "function") {
  UNINSPECTABLE_TYPES.push(FileList)
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
