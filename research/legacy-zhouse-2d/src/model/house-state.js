'use strict'

const { assertPoint, point } = require('../geometry/point')

const SCHEMA = 'legacy-zhouse-2d-reconstruction/v1'

function createHouseState(options = {}) {
  return {
    schema: SCHEMA,
    unit: 'mm',
    revision: 0,
    walls: [],
    rooms: [],
    metadata: { ...options.metadata },
  }
}

function createWallRecord({ id, start, end, thicknessMm, sourceMethod = null }) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('wall id must be a non-empty string')
  }
  assertPoint(start, 'start')
  assertPoint(end, 'end')
  if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) {
    throw new RangeError('thicknessMm must be greater than zero')
  }
  return {
    id,
    start: point(start.x, start.y),
    end: point(end.x, end.y),
    thicknessMm,
    sourceMethod,
  }
}

function appendWallRecord(state, wall) {
  assertHouseState(state)
  if (!wall || typeof wall !== 'object') {
    throw new TypeError('wall must be an object')
  }
  if (state.walls.some((candidate) => candidate.id === wall.id)) {
    throw new Error(`duplicate wall id: ${wall.id}`)
  }
  return {
    ...state,
    revision: state.revision + 1,
    walls: [...state.walls, structuredClone(wall)],
  }
}

function assertHouseState(state) {
  if (!state || state.schema !== SCHEMA || state.unit !== 'mm') {
    throw new TypeError(`state must use ${SCHEMA} with millimetre units`)
  }
  if (!Array.isArray(state.walls) || !Array.isArray(state.rooms)) {
    throw new TypeError('state walls and rooms must be arrays')
  }
  return state
}

module.exports = {
  SCHEMA,
  appendWallRecord,
  assertHouseState,
  createHouseState,
  createWallRecord,
}
