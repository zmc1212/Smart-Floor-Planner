'use strict'

const methodMap = require('../../provenance/method-map.json')

function createReconstructionEngine(initialState, implementations = {}) {
  let state = structuredClone(initialState)
  const trace = []
  const catalog = new Map(methodMap.methods.map((method) => [method.id, method]))

  function execute(methodId, input) {
    const method = catalog.get(methodId)
    if (!method) throw new Error(`unknown legacy method: ${methodId}`)
    const implementation = implementations[methodId]
    if (typeof implementation !== 'function' || method.status === 'located' || method.status === 'decompiled') {
      throw new Error(`legacy method is not reconstructed: ${methodId}`)
    }

    const before = structuredClone(state)
    const output = implementation(before, structuredClone(input))
    if (!output || !Object.hasOwn(output, 'state')) {
      throw new TypeError(`implementation must return { state, result }: ${methodId}`)
    }
    state = structuredClone(output.state)
    trace.push({ methodId, input: structuredClone(input), result: structuredClone(output.result) })
    return structuredClone(output.result)
  }

  return {
    execute,
    getState: () => structuredClone(state),
    getTrace: () => structuredClone(trace),
  }
}

module.exports = { createReconstructionEngine }
