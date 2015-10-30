
/**
 * Private field and method symbols.
 *
 * @type {Object<string, symbol>}
 */
const PRIVATE = Object.freeze({
  // fields
  aborted: Symbol("aborted"),
  active: Symbol("active"),
  queuedOperations: Symbol("queuedOperations"),
  transaction: Symbol("transaction"),

  // methods
  initRunner: Symbol("initRunner"),
  executedPendingOperations: Symbol("executedPendingOperations")
})

/**
 * The transaction runner is a utility for turning the IndexedDB short-lived
 * transactions into transactions that can be active for an arbitrary amount of
 * time.
 */
export default class TransactionRunner {
  /**
   * Initializes the transaction runner.
   *
   * @param {Transaction} transaction The indexed-db.es6 read-write
   *        transaction.
   * @param {string} keepAliveObjectStoreName The name of the object store to
   *        use to perform the transaction keep-alive operations.
   */
  constructor(transaction, keepAliveObjectStoreName) {
    /**
     * A flag signalling whether the transaction has been aborted.
     *
     * @type {boolean}
     */
    this[PRIVATE.aborted] = false

    /**
     * A flag signalling whether the transaction is still active.
     *
     * @type {boolean}
     */
    this[PRIVATE.active] = true

    /**
     * The operations scheduled to be executed in this transaction as soon as
     * the keep-alive operation is resolved.
     *
     * @type {function(Transaction)[]}
     */
    this[PRIVATE.queuedOperations] = []

    /**
     * The indexed-db.es transaction.
     *
     * @type {Transaction}
     */
    this[PRIVATE.transaction] = transaction

    this[PRIVATE.initRunner](transaction, keepAliveObjectStoreName)
  }

  /**
   * Queues the provided transaction operation to be executed as soon as
   * possible. The operation will not be executed if the transaction gets
   * aborted before the transaction runner is able to execute the operation.
   *
   * @param {function(Transaction)} operation
   */
  queueOperation(operation) {
    if (this[PRIVATE.aborted]) {
      throw new Error("The transaction has already been aborted")
    }
    if (!this[PRIVATE.active]) {
      throw new Error("The transaction is no longer active")
    }

    this[PRIVATE.queuedOperations].push(operation)
  }

  /**
   * Aborts the underlying transaction. The transaction runner will no longer
   * execute the queued pending operations.
   *
   * The methods also marks the transaction as no longer active.
   *
   * @return {Promise<undefined>} A promise that will be rejected with an
   *         AbortError if the transaction has been successfully aborted, or an
   *         ordinary error if the transaction has somehow completed
   *         successfully (this really shouldn't happen).
   */
  abort() {
    if (this[PRIVATE.aborted]) {
      throw new Error("The transaction has already been aborted")
    }
    if (!this[PRIVATE.active]) {
      throw new Error("The transaction is no longer active")
    }

    this[PRIVATE.aborted] = true
    this[PRIVATE.active] = false

    this[PRIVATE.transaction].abort()

    return this[PRIVATE.transaction].completionPromise.then(() => {
      throw new Error("Unexpected successful transaction end has occurred " +
          "after the transaction has been aborted. Has the transaction been " +
          "already committed?")
    })
  }

  /**
   * Executes the remaining queued pending operations and commits the
   * transaction.
   *
   * @return {Promise<undefined>} A promise that resolves once the transaction
   *         has been committed.
   */
  commit() {
    if (this[PRIVATE.aborted]) {
      throw new Error("The transaction has already been aborted")
    }
    if (!this[PRIVATE.active]) {
      throw new Error("The transaction is no longer active")
    }

    this[PRIVATE.active] = false

    return this[PRIVATE.transaction].completionPromise
  }

  /**
   * Returns {@code true} if the transaction is still active.
   *
   * @return {boolean} {@code true} if the transaction is still active.
   */
  get isActive() {
    return this[PRIVATE.active]
  }

  /**
   * Initializes the asynchronous runner of the operations in the transaction.
   * The runner will keep the transaction alive using keep-alive operations and
   * execute any pending queued operations every time the keep-alive operation
   * completes.
   *
   * The runner will terminate with running the remaining pending operations
   * once the {@code PRIVATE.active} flag is {@code false}.
   *
   * @param {Transaction} transaction The indexed-db.es6 read-write
   *        transaction.
   * @param {string} keepAliveObjectStoreName The name of the object store to
   *        use to perform the transaction keep-alive operations.
   */
  [PRIVATE.initRunner](transaction, keepAliveObjectStoreName) {
    let objectStore = transaction.getObjectStore(keepAliveObjectStoreName)

    keepAlive.call(this)

    function keepAlive() {
      this[PRIVATE.executedPendingOperations](transaction)

      objectStore.get(Number.MIN_SAFE_INTEGER).then(() => {
        if (this[PRIVATE.aborted]) {
          return
        }

        if (this[PRIVATE.active]) {
          keepAlive.call(this)
        } else {
          // finish pending operations
          this[PRIVATE.executedPendingOperations](transaction)
        }
      })
    }
  }

  /**
   * Executes all pending operations in this transaction.
   *
   * @param {Transaction} transaction The indexed-db.es transaction.
   */
  [PRIVATE.executedPendingOperations](transaction) {
    // prevent possible infinite loop that could be caused by operations
    // synchronously queueing more operations
    let operations = this[PRIVATE.queuedOperations]
    this[PRIVATE.queuedOperations] = []

    for (let operation of operations) {
      operation(transaction)
    }
  }
}
