'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createReconstructionEngine } = require('../src/engine/reconstruction-engine')
const { compareSnapshots } = require('../src/differential/canonicalize')
const { appendWallRecord, createHouseState, createWallRecord } = require('../src/model/house-state')
const { point } = require('../src/geometry/point')
const { appendCommand, createCommandBuffer, lineCommand } = require('../src/rendering/command-buffer')

test('research state is JSON-friendly and separate from the formal v4 contract', () => {
  const initial = createHouseState({ metadata: { fixture: 'first-wall' } })
  const wall = createWallRecord({
    id: 'wall-1',
    start: point(0, 0),
    end: point(3182, 0),
    thicknessMm: 200,
  })
  const next = appendWallRecord(initial, wall)

  assert.equal(initial.walls.length, 0)
  assert.equal(next.walls.length, 1)
  assert.equal(next.revision, 1)
  assert.notEqual(next.schema, 'survey-wall-graph')
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next)
})

test('located metadata cannot accidentally execute as a reconstructed method', () => {
  const engine = createReconstructionEngine(createHouseState(), {
    'House2DAlgorithm.CanChangeThick': () => ({ state: createHouseState(), result: true }),
  })
  assert.throws(
    () => engine.execute('House2DAlgorithm.CanChangeThick', {}),
    /legacy method is not reconstructed/
  )
  assert.equal(engine.getTrace().length, 0)
})

test('reconstructed metadata still requires an explicitly registered implementation', () => {
  const engine = createReconstructionEngine(createHouseState())
  assert.throws(
    () => engine.execute('House2DAlgorithm.AddRoom', {}),
    /legacy method is not reconstructed/
  )
  assert.equal(engine.getTrace().length, 0)
})

test('render commands stay platform-independent and deterministic', () => {
  const buffer = appendCommand(
    createCommandBuffer({ fixture: 'centerline' }),
    lineCommand(point(0, 0), point(1000, 0), { stroke: '#000000', widthMm: 1 })
  )
  assert.equal(buffer.commands.length, 1)
  assert.equal(buffer.commands[0].type, 'line')
  assert.equal(Object.hasOwn(buffer.commands[0], 'canvasContext'), false)
})

test('differential snapshots ignore object-key order but preserve operation order', () => {
  const same = compareSnapshots(
    { methodId: 'AddWall', output: { result: 1, walls: ['a', 'b'] } },
    { output: { walls: ['a', 'b'], result: 1 }, methodId: 'AddWall' }
  )
  assert.equal(same.equal, true)

  const reorderedOperations = compareSnapshots(
    { walls: ['a', 'b'] },
    { walls: ['b', 'a'] }
  )
  assert.equal(reorderedOperations.equal, false)
})
