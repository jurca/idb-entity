
export function promiseIt(behavior, test) {
  it(behavior, (done) => {
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
