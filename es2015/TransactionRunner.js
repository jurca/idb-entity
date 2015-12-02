
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
  options: Symbol("options"),
  idleSince: Symbol("idleSince"),
  idleWarningSent: Symbol("idleWarningSent"),

  // methods
  initRunner: Symbol("initRunner"),
  checkIdleStatus: Symbol("checkIdleStatus"),
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
   * @param {{ttl: number, warningDelay: number, observer: function(TransactionRunner, boolean)}} options
   *        Configuration for handling pending idle transactions. See the
   *        constructor of the {@linkcode EntityManagerFactory} for details.
   * @see EntityManagerFactory#constructor
   */
  constructor(transaction, keepAliveObjectStoreName, options) {
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
     * The indexed-db.es6 transaction.
     *
     * @type {Transaction}
     */
    this[PRIVATE.transaction] = transaction

    /**
     * Configuration for handling pending idle transactions.
     *
     * @type {{ttl: number, warningDelay: number, observer: (function(TransactionRunner, boolean))}}
     */
    this[PRIVATE.options] = options

    /**
     * A UNIX timestamp with millisecond precision marking the moment since
     * which the transaction has been idle (had no pending operations).
     *
     * @type {?number}
     */
    this[PRIVATE.idleSince] = null

    /**
     * A flag signalling whether the observer has been notified that the
     * transaction is idle since the last time the transaction has become idle.
     *
     * @type {boolean}
     */
    this[PRIVATE.idleWarningSent] = false

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
      this[PRIVATE.checkIdleStatus]()

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
   * Checks whether the transaction is idle (has no pending operations), how
   * long it has been idle and whether the transaction should be aborted and/or
   * the idle transaction observer notified.
   */
  [PRIVATE.checkIdleStatus]() {
    if (!this[PRIVATE.idleSince]) {
      if (!this[PRIVATE.queuedOperations].length) {
        this[PRIVATE.idleSince] = Date.now()
      }
      return
    }

    if (this[PRIVATE.queuedOperations].length) {
      this[PRIVATE.idleSince] = null
      this[PRIVATE.idleWarningSent] = false
      return
    }

    let idleDuration = Date.now() - this[PRIVATE.idleSince]
    if (idleDuration > this[PRIVATE.options].ttl) {
      if (this[PRIVATE.aborted]) {
        return
      }
      this.abort().catch((error) => {
        // we already notified the observer of this abort error, ignore
        // TODO: maybe send the error to the observer?
      })
      // TODO: it would be nice to pass the high-level transaction to the
      // observer instead of this transaction runner
      this[PRIVATE.options].observer(this, true)
    } else if (idleDuration > this[PRIVATE.options].warningDelay) {
      if (this[PRIVATE.idleWarningSent]) {
        return
      }
      this[PRIVATE.idleWarningSent] = true
      this[PRIVATE.options].observer(this, false)
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
