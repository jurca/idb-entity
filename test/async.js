
export default function async(generator) {
  return new Promise((resolve, reject) => {
    let iterator

    try {
      iterator = generator()
      await(iterator.next())
    } catch (error) {
      reject(error)
    }

    function await(iteration) {
      let value = iteration.value
      if (iteration.done) {
        Promise.resolve(value).then(resolve).catch(reject)
      }

      Promise.resolve(value).then(resume).catch(reject)
    }

    function resume(awaitedValue) {
      await(iterator.next(awaitedValue))
    }
  })
}
