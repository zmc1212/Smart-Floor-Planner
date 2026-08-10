'use strict'

const methodMap = require('../provenance/method-map.json')

const allowedStatuses = new Set(methodMap.statusOrder)
const ids = new Set()
const rvas = new Set()

if (!Array.isArray(methodMap.methods) || methodMap.methods.length === 0) {
  throw new Error('method map must contain methods')
}

for (const method of methodMap.methods) {
  if (!method.id || !method.type || !method.signature) throw new Error('method entry is incomplete')
  if (!/^0x[0-9A-F]+$/i.test(method.rva)) throw new Error(`invalid RVA for ${method.id}`)
  if (!allowedStatuses.has(method.status)) throw new Error(`invalid status for ${method.id}`)
  if (ids.has(method.id)) throw new Error(`duplicate method id: ${method.id}`)
  if (rvas.has(method.rva)) throw new Error(`duplicate method RVA: ${method.rva}`)
  if (['located', 'decompiled'].includes(method.status) && method.implementation !== null) {
    throw new Error(`unverified method must not name an implementation: ${method.id}`)
  }
  ids.add(method.id)
  rvas.add(method.rva)
}

process.stdout.write(`verified ${methodMap.methods.length} provenance entries\n`)
