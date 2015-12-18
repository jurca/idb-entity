
var allTestFiles = []
var TEST_REGEXP = /(spec|test)\.js$/i

// load project and tests files and normalize paths to RequireJS module names
for (var file of Object.keys(window.__karma__.files)) {
  if (TEST_REGEXP.test(file)) {
    allTestFiles.push(pathToModule(file))
  }
}

require.config({
  // Karma serves files under /base, which is the basePath from your config file
  baseUrl: "/base",

  paths: {
  },

  // dynamically load all test files
  deps: allTestFiles,

  // we have to kickoff jasmine, as it is asynchronous
  callback: window.__karma__.start
})

function pathToModule (path) {
  return path.replace(/^\/base\//, "").replace(/\.js$/, "")
}
