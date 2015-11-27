
import AbstractEntity from "../es2015/AbstractEntity"
import {specifiesObjectStore} from "../es2015/AbstractEntity"

describe("AbstractEntity", () => {

  describe("class", () => {

    it("should be abstract", () => {
      expect(() => {
        AbstractEntity.objectStore = "foo"
        new AbstractEntity({})
      }).toThrow()
      delete AbstractEntity.objectStore
    })

    it("should require the object store to be defined", () => {
      expect(() => {
        class Entity extends AbstractEntity {}
        new Entity()
      }).toThrow()

      class Entity extends AbstractEntity {}
      Entity.objectStore = "foo"
      new Entity()
    })

    it("should clone the data passed to the constructor", () => {
      class Entity extends AbstractEntity {
        static get objectStore() { return "foo" }
      }

      let data = {
        a: 1,
        b: true,
        c: ["bar"],
        baz: {
          a: "a",
          b: "x"
        }
      }
      let entity = new Entity(data)
      expect(Object.assign({}, entity)).toEqual(data)
    })

  })

  describe("specifiesObjectStore", () => {

    it("should test whether a class specifies an object store", () => {
      class Entity {}
      expect(specifiesObjectStore(Entity)).toBeFalsy()
      Entity.objectStore = 1
      expect(specifiesObjectStore(Entity)).toBeFalsy()
      Entity.objectStore = ""
      expect(specifiesObjectStore(Entity)).toBeFalsy()
      Entity.objectStore = "a"
      expect(specifiesObjectStore(Entity)).toBeTruthy()

      class Entity2 {
        static get objectStore() {
          return "foo"
        }
      }
      expect(specifiesObjectStore(Entity2)).toBeTruthy()

      class Entity3 {
        get objectStore() {
          return "foo"
        }
      }
      expect(specifiesObjectStore(Entity3)).toBeFalsy()
    })

  })

})
