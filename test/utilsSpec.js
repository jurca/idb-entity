
import * as utils from "../es2015/utils"
import clone from "../es2015/clone"
import equals from "../es2015/equals"

describe("utils", () => {

  it("should export clone and equals utilities", () => {
    expect(utils.clone).toBe(clone)
    expect(utils.equals).toBe(equals)
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

})
