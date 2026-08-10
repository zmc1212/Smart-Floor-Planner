'use strict'

const { add, assertFiniteNumber, leftNormal, scale, subtract } = require('./point')
const { assertSegment, segment } = require('./segment')

function buildWallFaces(centerline, thicknessMm) {
  assertSegment(centerline, 'centerline')
  assertFiniteNumber(thicknessMm, 'thicknessMm')
  if (thicknessMm <= 0) {
    throw new RangeError('thicknessMm must be greater than zero')
  }

  const normal = leftNormal(subtract(centerline.end, centerline.start))
  const offset = scale(normal, thicknessMm / 2)
  return {
    left: segment(add(centerline.start, offset), add(centerline.end, offset)),
    right: segment(subtract(centerline.start, offset), subtract(centerline.end, offset)),
  }
}

module.exports = { buildWallFaces }
