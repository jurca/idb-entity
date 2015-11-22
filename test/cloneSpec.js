
import async from "./async"
import clone from "../es2015/clone"
import equals from "../es2015/equals"

describe("clone", () => {

  it("should clone primitive values", () => {
    testClone(true)
    testClone(false)

    testClone(4)
    testClone(3.141592553598)

    testClone("abcd")
  })

  it("should clone wrapped primitive values", () => {
    testClone(new Boolean(true))
    testClone(new Number(12345))
    testClone(new String("abcd"))
  })

  it("should clone dates", () => {
    testClone(new Date(1234567890))
  })

  it("should clone regexpes", () => {
    testClone(/abc/i)
  })

  it("should just return blobs", () => {
    testClone(new Blob(["abcd"]), false)
  })

  it("should just return file lists", () => {
    let input = document.createElement("input")
    input.type = "file"
    testClone(input.files, false)
  })

  it("should clone ImageData instances", () => {
    let canvas = document.createElement("canvas")
    canvas.width = 2
    canvas.height = 2

    let context = canvas.getContext("2d")
    let imageData = context.getImageData(0, 0, 2, 2)
    testClone(imageData)
  })

  it("should just return ImageBitmap instances", (done) => {
    if (typeof createImageBitmap !== "function") {
      done()
      return
    }

    if (navigator.userAgent.indexOf("Firefox") > -1) {
      // Creating image bitmaps seems to freeze Firefox at the moment of
      // writing these tests :(. Maybe it is because of the lack of WebGL
      // support in the testing environment?
      done()
      return
    }

    let canvas = document.createElement("canvas")
    canvas.width = 2
    canvas.height = 2

    async(function * () {
      let bitmap = yield createImageBitmap(canvas, 0, 0, 2, 2)
      testClone(bitmap, false)
      done()
    })
  })

  it("should clone ArrayBuffer instances", () => {
    let buffer = new ArrayBuffer(3)
    let intArray = new Int8Array(buffer)
    intArray[0] = 5
    intArray[1] = 7
    testClone(buffer)
  })

  it("should clone DataView instances", () => {
    let buffer = new ArrayBuffer(8)
    let view = new DataView(buffer, 2, 4)
    view.setInt8(2, 7)
    testClone(view)
  })

  it("should clone typed arrays", () => {
    let arr = new Int8Array(3)
    arr[1] = 2
    testClone(arr)
  })

  it("should clone arrays", () => {
    testClone([1, 2, 3])

    let arr = new Array(4)
    arr[1] = 5
    testClone(arr)
  })

  it("should clone plain objects", () => {
    testClone({
      a: 1,
      b: "foo",
      c: true
    })
  })

  it("should clone cyclic objects", () => {
    let cyclic1 = {
      foo: {
        xy: "z"
      }
    }
    cyclic1.foo.bar = cyclic1.foo
    testClone(cyclic1)

    let cyclic2 = {
      foo: {},
      bar: {}
    }
    cyclic2.foo.bar = cyclic2.bar
    cyclic2.bar.foo = cyclic2.foo
    testClone(cyclic2)
  })

  it("should clone maps", () => {
    let map1 = new Map()
    map1.set(1, "yay")
    map1.set("cyclic", map1)
    testClone(map1)

    let map2 = new Map()
    map2.set(map2, "cyclic")
    testClone(map2)
  })

  it("should clone sets", () => {
    let set1 = new Set()
    set1.add(1)
    set1.add(set1)
    testClone(set1)
  })

  function testClone(value, mustBeDistinct = true) {
    let clonedValue = clone(value)
    if (mustBeDistinct && (value instanceof Object)) {
      expect(value).not.toBe(clonedValue)
    }

    return expect(equals(value, clonedValue)).toBeTruthy()
  }

})
