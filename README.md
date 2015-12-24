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
