'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { point } = require('../src/geometry/point')
const { area, centroid, signedArea } = require('../src/geometry/polygon')
const { intersectSegments, segment } = require('../src/geometry/segment')
const { buildWallFaces } = require('../src/geometry/wall-faces')

test('intersects crossing segments with stable parameters', () => {
  const result = intersectSegments(
    segment(point(0, 0), point(1000, 1000)),
    segment(point(0, 1000), point(1000, 0))
  )
  assert.equal(result.kind, 'point')
  assert.deepEqual(result.point, point(500, 500))
  assert.equal(result.t, 0.5)
  assert.equal(result.u, 0.5)
})

test('distinguishes overlap from a single endpoint intersection', () => {
  const overlap = intersectSegments(
    segment(point(0, 0), point(1000, 0)),
    segment(point(250, 0), point(750, 0))
  )
  assert.equal(overlap.kind, 'overlap')
  assert.deepEqual(overlap.segment, segment(point(250, 0), point(750, 0)))

  const endpoint = intersectSegments(
    segment(point(0, 0), point(1000, 0)),
    segment(point(1000, 0), point(1000, 500))
  )
  assert.equal(endpoint.kind, 'point')
  assert.deepEqual(endpoint.point, point(1000, 0))
})

test('returns none for parallel separated segments', () => {
  const result = intersectSegments(
    segment(point(0, 0), point(1000, 0)),
    segment(point(0, 200), point(1000, 200))
  )
  assert.deepEqual(result, { kind: 'none' })
})

test('computes orientation, area, and centroid in millimetres', () => {
  const rectangle = [point(0, 0), point(2230, 0), point(2230, 3182), point(0, 3182)]
  assert.equal(signedArea(rectangle), 7095860)
  assert.equal(area([...rectangle].reverse()), 7095860)
  assert.deepEqual(centroid(rectangle), point(1115, 1591))
})

test('derives symmetric wall faces from a centerline without choosing room semantics', () => {
  const faces = buildWallFaces(segment(point(0, 0), point(1000, 0)), 200)
  assert.deepEqual(faces.left, segment(point(0, 100), point(1000, 100)))
  assert.deepEqual(faces.right, segment(point(0, -100), point(1000, -100)))
})
