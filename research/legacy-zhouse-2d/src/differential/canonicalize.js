'use strict'

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('differential snapshots cannot contain non-finite numbers')
    }
    return value
  }

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = canonicalize(value[key])
      return result
    }, {})
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value))
}

function compareSnapshots(expected, actual) {
  const expectedCanonical = stableStringify(expected)
  const actualCanonical = stableStringify(actual)
  return {
    equal: expectedCanonical === actualCanonical,
    expectedCanonical,
    actualCanonical,
  }
}

module.exports = { canonicalize, compareSnapshots, stableStringify }
