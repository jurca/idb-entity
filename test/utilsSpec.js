
import * as utils from "../es2015/utils"
import clone from "../es2015/clone"
import equals from "../es2015/equals"
import AbstractEntity from "../es2015/AbstractEntity"
import {specifiesObjectStore} from "../es2015/AbstractEntity"

describe("utils", () => {

  it("should export clone, equals and specifiesObjectStore utilities", () => {
    expect(utils.clone).toBe(clone)
    expect(utils.equals).toBe(equals)
    expect(utils.specifiesObjectStore).toBe(specifiesObjectStore)
  })

  it("should serialize IndexedDB keys", () => {
    expect(utils.serializeKey(1)).toBe("1")
    expect(utils.serializeKey("ab")).toBe("\"ab\"")
    expect(utils.serializeKey("1")).toBe("\"1\"")
    expect(utils.serializeKey(new Date(123456789))).toBe("Date(123456789)")
    expect(utils.serializeKey([1, "b", new Date(7)])).toBe("1,\"b\",Date(7)")
  })

  it("should retrieve the primary key of an entity", () => {
    expect(utils.getPrimaryKey({
      id: 1
    }, "id")).toBe(1)
    expect(utils.getPrimaryKey({
      id: {
        foo: {
          bar: "baz"
        }
      }
    }, "id.foo.bar")).toBe("baz")
    expect(utils.getPrimaryKey({
      id1: new Date(1234),
      id2: {
        foo: "bar"
      },
      id3: 2
    }, ["id1", "id2.foo", "id3"])).toEqual([new Date(1234), "bar", 2])
  })

  it("should set the primary key of an entity", () => {
    let entity1 = {}
    utils.setPrimaryKey(entity1, "id", 1)
    expect(entity1).toEqual({
      id: 1
    })

    let entity2 = { old: "stuff" }
    utils.setPrimaryKey(entity2, "foo.bar", "baz")
    expect(entity2).toEqual({
      old: "stuff",
      foo: {
        bar: "baz"
      }
    })

    let entity3 = {}
    utils.setPrimaryKey(entity3, ["id1", "id2.foo"], [new Date(12), 4])
    expect(entity3).toEqual({
      id1: new Date(12),
      id2: {
        foo: 4
      }
    })
  })

  it("should validate en entity class", () => {
    expect(() => {
      utils.validateEntityClass(class Entity {})
    }).toThrow()
    expect(() => {
      utils.validateEntityClass(class Entity {
        static get objectStore() {
          return 1
        }
      })
    }).toThrow()
    expect(() => {
      utils.validateEntityClass(class Entity extends AbstractEntity {
        static get objectStore() {
          return ""
        }
      })
    }).toThrow()
    expect(() => {
      utils.validateEntityClass(class Entity {
        static get objectStore() {
          return "fooBar"
        }
      })
    }).toThrow()

    utils.validateEntityClass(class Entity extends AbstractEntity {
      static get objectStore() {
        return "fooBar"
      }
    })
  })

  it("should test if a class is a subclass of another", () => {
    class A {}
    class B {}
    class C extends A {}
    class D extends B {}
    class E extends C {}

    expect(utils.isSubClass(A, B)).toBeFalsy()
    expect(utils.isSubClass(C, A)).toBeTruthy()
    expect(utils.isSubClass(E, A)).toBeTruthy()
    expect(utils.isSubClass(D, C)).toBeFalsy()
  })

})
