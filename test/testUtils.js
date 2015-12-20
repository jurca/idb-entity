
export function promiseIt(behavior, test, force = false) {
  let testFunction = force ? fit : it
  testFunction(behavior, (done) => {
    test().then(done).catch((error) => {
      fail(error)
      done()
    })
  })
}

export function delay(time) {
  return new Promise((resolve) => {
    setTimeout(resolve, time)
  })
}
