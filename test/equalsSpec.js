
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

})
