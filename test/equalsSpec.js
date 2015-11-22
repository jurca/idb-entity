
import async from "./async"
import equals from "../es2015/equals"

describe("equals", () => {

  it("should compare primitive types (except for symbols)", () => {
    expect(equals(true, true)).toBeTruthy()
    expect(equals(true, false)).toBeFalsy()

    expect(equals(2, 2)).toBeTruthy()
    expect(equals(4, 3)).toBeFalsy()
    expect(equals(6.83, 6.83)).toBeTruthy()
    expect(equals(6.71, 1.42)).toBeFalsy()

    expect(equals("abc", "abc")).toBeTruthy()
    expect(equals("def", "ghi")).toBeFalsy()
  })

  it("should compare wrapped primitive values", () => {
    expect(equals(new Boolean(true), new Boolean(true))).toBeTruthy()
    expect(equals(new Boolean(true), new Boolean(false))).toBeFalsy()

    expect(equals(new Number(2), new Number(2))).toBeTruthy()
    expect(equals(new Number(4), new Number(3))).toBeFalsy()
    expect(equals(new Number(6.83), new Number(6.83))).toBeTruthy()
    expect(equals(new Number(6.71), new Number(1.42))).toBeFalsy()

    expect(equals(new String("abc"), new String("abc"))).toBeTruthy()
    expect(equals(new String("def"), new String("ghi"))).toBeFalsy()
  })

  it("should compare Dates", () => {
    expect(equals(new Date(1234567890), new Date(1234567890))).toBeTruthy()
    expect(equals(new Date(1234567890), new Date(1234567987))).toBeFalsy()
  })

  it("should compare RegExps", () => {
    expect(equals(/ab/i, /ab/i)).toBeTruthy()
    expect(equals(/abc/, /ab/)).toBeFalsy()
  })

  it("should compare Blobs by identity", () => {
    let blob = new Blob(["abcdef"])
    expect(equals(blob, blob)).toBeTruthy()
    expect(equals(blob, new Blob(["abcdef"]))).toBeFalsy()
  })

  it("should compare FileLists by identity", () => {
    let input = document.createElement("input")
    input.type = "file"

    expect(equals(input.files, input.files)).toBeTruthy()

    let input2 = document.createElement("input")
    input2.type = "file"
    expect(equals(input.files, input2.files)).toBeFalsy()
  })

  it("should compare ImageData instances", () => {
    let canvas = document.createElement("canvas")
    canvas.width = 2
    canvas.height = 2

    let context = canvas.getContext("2d")
    let imageData1 = context.getImageData(0, 0, 2, 2)
    let imageData2 = context.getImageData(0, 0, 2, 2)
    expect(equals(imageData1, imageData2)).toBeTruthy()
    expect(equals(imageData1, context.getImageData(0, 0, 1, 2))).toBeFalsy()

    context.fillStyle = "rgb(10, 20, 30)"
    context.fillRect(1, 1, 1, 1)
    expect(equals(imageData1, context.getImageData(0, 0, 2, 2))).toBeFalsy()
  })

  it("should compare ImageBitmap instances by identity", (done) => {
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
      let bitmap1 = yield createImageBitmap(canvas, 0, 0, 2, 2)
      let bitmap2 = yield createImageBitmap(canvas, 0, 0, 2, 2)

      expect(equals(bitmap1, bitmap1)).toBeTruthy()
      expect(equals(bitmap1, bitmap2)).toBeFalsy()
      done()
    })
  })

  it("should compare ArrayBuffer instances", () => {
    let buffer1 = new ArrayBuffer(3)
    let buffer2 = new ArrayBuffer(3)
    let buffer3 = new ArrayBuffer(4)

    new Int8Array(buffer1)[1] = 1
    new Int8Array(buffer2)[1] = 1
    expect(equals(buffer1, buffer2)).toBeTruthy()

    new Int8Array(buffer1)[1] = 2
    expect(equals(buffer1, buffer2)).toBeFalsy()

    new Int8Array(buffer3)[1] = 1
    expect(equals(buffer2, buffer3)).toBeFalsy()
  })

  it("should compare DataView instances", () => {
    let buffer = new ArrayBuffer(8)
    let view1 = new DataView(buffer, 0, 3)
    let view2 = new DataView(buffer, 0, 4)
    let view3 = new DataView(buffer, 4, 3)

    view1.setInt8(1, 1)
    expect(equals(view1, view2)).toBeFalsy()

    expect(equals(view1, view3)).toBeFalsy()
    view3.setInt8(1, 1)
    expect(equals(view1, view3)).toBeTruthy()
  })

  it("should compare typed arrays", () => {
    let arr1 = new Int16Array(4)
    arr1[0] = 1
    arr1[1] = 2

    let arr2 = new Int16Array(4)
    arr2[0] = 1
    arr2[1] = 2

    let arr3 = new Int16Array(5)
    arr3[0] = 1
    arr3[1] = 2

    let arr4 = new Int8Array(arr1.buffer.slice())

    expect(equals(arr1, arr2)).toBeTruthy()
    expect(equals(arr1, arr3)).toBeFalsy()
    expect(equals(arr1, arr4)).toBeFalsy()
  })

  it("should compare arrays", () => {
    let arr1 = [1, 2, 3]
    let arr2 = [1, 2, 3]
    let arr3 = [1, 2, 3, 4]

    expect(equals(arr1, arr2)).toBeTruthy()
    expect(equals(arr1, arr3)).toBeFalsy()
  })

  it("should compare plain objects", () => {
    let o1 = {
      a: 1,
      b: "test",
      c: true
    }
    let o2 = {
      a: 1,
      b: "test",
      c: true
    }
    let o3 = {
      a: 1,
      c: true
    }
    let o4 = {
      a: 1,
      b: "test",
      c: true,
      d: "something"
    }
    expect(equals(o1, o2)).toBeTruthy()
    expect(equals(o1, o3)).toBeFalsy()
    expect(equals(o1, o4)).toBeFalsy()
  })

  it("should compare cyclic references", () => {
    let cyclic1 = {
      foo: {
        xy: "z"
      }
    }
    cyclic1.foo.bar = cyclic1.foo
    let cyclic2 = {
      foo: {
        xy: "z"
      }
    }
    cyclic2.foo.bar = cyclic2.foo
    expect(equals(cyclic1, cyclic2)).toBeTruthy()

    let cyclic3 = {
      foo: {},
      bar: {}
    }
    cyclic3.foo.bar = cyclic3.bar
    cyclic3.bar.foo = cyclic3.foo
    let cyclic4 = {
      foo: {},
      bar: {}
    }
    cyclic4.foo.bar = cyclic4.bar
    cyclic4.bar.foo = cyclic4.foo
    expect(equals(cyclic3, cyclic4)).toBeTruthy()
  })

  it("should compare Map instances", () => {
    let map1 = new Map()
    map1.set(1, "yay")
    map1.set("cyclic", map1)

    let map2 = new Map()
    map2.set(1, "yay")
    map2.set("cyclic", map2)

    let map3 = new Map()
    map3.set(1, "yay")
    map3.set("cyclic", false)

    expect(equals(map1, map2)).toBeTruthy()
    expect(equals(map1, map3)).toBeFalsy()

    let map4 = new Map()
    map4.set(map4, "cyclic")

    let map5 = new Map()
    map5.set(map5, "cyclic")
    expect(equals(map4, map5)).toBeTruthy()
  })

  it("should compare Set instances", () => {
    let set1 = new Set()
    set1.add(1)
    set1.add(set1)

    let set2 = new Set()
    set2.add(1)
    set2.add(set2)

    let set3 = new Set()
    set3.add(1)
    set3.add(set2)

    expect(equals(set1, set2)).toBeTruthy()
    expect(equals(set1, set3)).toBeFalsy()
  })

})
