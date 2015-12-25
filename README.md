# idb-entity

[![Build Status](https://travis-ci.org/jurca/idb-entity.svg?branch=master)](https://travis-ci.org/jurca/idb-entity)

The idb-entity is an ORM-like Entity manager for the HTML5
[IndexedDB](http://www.w3.org/TR/IndexedDB/). The idb-entity has
[Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)-oriented
API and provides an advanced query API (provided by the
[indexed-db.es6](https://github.com/jurca/indexed-db.es6) library).

## Quickstart

Here you will find the basic information on how to use the idb-entity library.
Please check the [Wiki](https://github.com/jurca/idb-entity/wiki) and the
[indexed-db.es6 library](https://github.com/jurca/indexed-db.es6) for a more
detailed description and examples.

You can install the idb-entity library into your project using npm:

```
npm install --save idb-entity
```

Next you can choose to use either the ES2015 modules (located in `es2015/`), or
you may use any transpiler you like (for example Babel or Traceur) to transpile
the ES2015 modules to a module system of your choice.

### Connecting to a database

The idb-entity relies on the indexed-db.es6 for database connection and
low-level operations. A quick example is shown below, more detailed description
can be found at the
[indexed-db.es6 project's website](https://github.com/jurca/indexed-db.es6).

```javascript
import DBFactory from "indexed-db.es6/es2015/DBFactory"
import EntityManagerFactory from "idb-entity/es2015/EntityManagerFactory"

let entityManagerFactoryPromise = DBFactory.open("my database", {
  version: 1,
  objectStores: [{
    name: "fooBar",
    keyPath: null,
    autoIncrement: true,
    indexes: [{
      name: "some index",
      keyPath: "id",
      unique: false,
      multiEntry: true
    }]
  }]
}).then((database) => {
  return new EntityManagerFactory(database)
})
```

Alternatively, the `EntityManagerFactory` also accepts a connection promise:

```javascript
import DBFactory from "indexed-db.es6/es2015/DBFactory"
import EntityManagerFactory from "idb-entity/es2015/EntityManagerFactory"

let connectionPromise = DBFactory.open("my database", {
  ... // database schema goes here
})

let entityManagerFactory = new EntityManagerFactory(connectionPromise)
```

Once you are done communicating with the database, you can close the
connection using the `close()` method:

```javascript
entityManagerFactory.close().then(() => {
  // the connection is now terminated
})
```

### Defining entity types

The entity manager relies on typed entities instead of plain objects and object
store names for practical reasons (this also makes code debugging easier). To
define an entity type, create a new class that extends the `AbstractEntity`
class and defines the static `objectStore` property:

```javascript
import AbstractEntity from "idb-entity/es2015/AbstractEntity"

export default class FooBar extends AbstractEntity {
  static get objectStore() {
    return "fooBar" // must be a non-empty string
  }
}
```

The `objectStore` property defines the name of the Indexed DB object store the
entity manager will use to store the entities of this type. The object stores
must not be shared among entity types.

The fact that entities are class instances allows for entities to have computed
properties that are not stored in the database, thus ensuring easier data
consistency and less storage usage. Another use of the entity classes is to
add various utility methods:

```javascript
import AbstractEntity from "idb-entity/es2015/AbstractEntity"

export default class FooBar extends AbstractEntity {
  static get objectStore() {
    return "fooBar"
  }
  
  get age() {
    let now = new Date()
    let dob = this.dateOfBirth
    let diff = now.getFullYear() - dob.getFullYear()
    if (now.getMonth() < dob.getMonth()) {
      diff--
    } else if (now.getMonth() === dob.getMonth()) {
      if (now.getDate() < dob.getDate()) {
        diff--
      }
    }
    return diff
  }
  
  toString() {
    return `FooBar{name: ${this.name}, dob: ${this.dateOfBirth}}`
  }
  
  fetchContacts() {
    return ... // fetch contacts from storage, return promise
  }
}
```

The `AbstractEntity` class also provides the default entity constructor which
accepts a single plain object (`Object<string, *>`) and sets all its properties
on the entity instance. In case an entity needs to override the default
constructor, it is recommended to keep the first constructor parameter for
passing the entity data and keep in mind that any other parameter will be most
of the time `undefined` or set their default value (this is how the entity
manager creates entity instances and sets data on them):

```javascript
import AbstractEntity from "idb-entity/es2015/AbstractEntity"

export default class FooBar extends AbstractEntity {
  static get objectStore() {
    return "fooBar"
  }
  
  constructor(data = {}, immutable = false) {
    super(data)
    
    console.log("entity FooBar created", data)
    
    if (immutable) {
      Object.freeze(this)
    }
  }
}
```

Last but not least, the entities are stored in the Indexed DB as plain objects,
and may contain any data and structures (including circular references)
supported by the Structured clone algorithm
([documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm),
[specification](http://www.w3.org/html/wg/drafts/html/master/infrastructure.html#safe-passing-of-structured-data)).
The only limitation is that an entity must always be an `AbstractEntity`
instance (using primitive data types makes little sense with an entity
manager) and an entity must not contain a circular reference to itself (this
limitation is caused by the way the data is set on the entity, and may be
removed in the future if deemed useful).

### Getting an entity manager

The entity manager is used to handle entity manipulation. To get an instance of
the entity manager, use the `createEntityManager()` method:

```javascript
let entityManager = entityManagerFactory.createEntityManager()
```

Every entity manager instance should be used only for a single operation (for
example reacting to a user action or a message received from the server). Once
the operation at hand has been handled, the entity manager instance should be
discarded.

Entity manager instances should never be used between operations, nor should a
single instance be shared across the whole application - this would most likely
lead to data consistency issues and errors caused by attempting to start
multiple (read-write) transactions on the same entity manager.

Note that the entity manager manages entities in a persistence context only
while a transaction is active, because the data consistency is impossible to
assure outside a transaction. The entity manager's persistence context is
automatically cleared after a transaction is ended.

### Fetching entities

The entity manager allows you to fetch entities from an Indexed DB database
without having to explicitly start a new transaction. Single records can be
fetched using the `find()` method:

```javascript
entityManager.find(FooBar /* entity class */, primaryKey).then((entity) => {
  // do something
})
```

It is also possible to execute high-level queries on an entity object store:

```javascript
entityManager.query(
  FooBar /* entity class */,
  optionalFilter,
  optionalOrderBy,
  optionalOffset,
  optionalLimit
).then((entities) => {
  // do something
})
```

The query API is quite powerful, you can learn more about it at the
indexed-db.es6
[wiki](https://github.com/jurca/indexed-db.es6/wiki/Running-queries).

### Saving and deleting single entities

Entities can be saved in the database using the `persist()` method:

```javascript
let entity = new FooBar({
  foo: "bar",
  created: new Date()
})
entityManager.persist(entity).then((savedEntity) => {
  entity === savedEntity // true
  // the entity will have its primary key set on its key path
})
```

To delete a previously created entity, use the `remove()` method:

```javascript
entityManager.remove(FooBar /* entity class */, primaryKey).then(() => {
  // the entity has been deleted
})
```

### Updating and deleting groups of entities

Groups of entities can be easily modified using the `updateQuery()` method:

```javascript
entityManager.updateQuery(
  FooBar /* entity class */,
  optionalFilter,
  optionalOrderBy,
  optionalOffset,
  optionalLimit
)((entity) => {
  // modify the entity as needed, there is no need to return the entity
}).then((updatedEntitiesCount) => {
  // do something
})
```

To delete a group of entities, use the `deleteQuery()` method:

```javascript
entityManager.deleteQuery(
  FooBar /* entity class */,
  optionalFilter,
  optionalOrderBy,
  optionalOffset,
  optionalLimit
).then((deletedEntitiesCount) => {
   // do something
 })
```

## API Documentation

The source code is well documented using [JSDoc](http://usejsdoc.org/) docblock
comments. Go ahead and
[take a look](https://github.com/jurca/idb-entity/tree/master/es2015)!

## Browser support

The browser compatibility is provided by the
[indexed-db.es6](https://github.com/jurca/indexed-db.es6) library. To see the
current browser compatibility, see the
[library documentation](https://github.com/jurca/indexed-db.es6#browser-support).

## The current state of this project

There are no current plans for additional features (unless a good case for
adding them is made), but the project accepts bug fixes if new bugs are
discovered.

## Contributing

Time is precious, so, if you would like to contribute (bug fixing, test writing
or feature addition), follow these steps:

* fork
* implement (follow the code style)
* pull request
* wait for approval/rejection of the pull request

Filing a bug issue *might* get me to fix the bug, but filing a feature request
will not as I don't have the time to work on this project full-time. Thank you
for understanding.
