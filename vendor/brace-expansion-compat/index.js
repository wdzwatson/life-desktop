'use strict'

const implementation = require('brace-expansion-core')
const expand = implementation.expand ?? implementation.default ?? implementation

// Keep the CommonJS callable export expected by minimatch 3 and expose the
// named/default forms used by newer minimatch releases.
module.exports = expand
module.exports.expand = expand
module.exports.default = expand
