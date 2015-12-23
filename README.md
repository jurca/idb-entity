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
