'use strict'

const { DEFAULT_EPSILON, assertPoint, point } = require('./point')

function assertPolygon(points, name = 'points') {
  if (!Array.isArray(points) || points.length < 3) {
    throw new TypeError(`${name} must contain at least three points`)
  }
  points.forEach((value, index) => assertPoint(value, `${name}[${index}]`))
  return points
}

function signedArea(points) {
  assertPolygon(points)
  let twiceArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    twiceArea += current.x * next.y - next.x * current.y
  }
  return twiceArea / 2
}

function area(points) {
  return Math.abs(signedArea(points))
}

function centroid(points, epsilon = DEFAULT_EPSILON) {
  assertPolygon(points)
  const polygonSignedArea = signedArea(points)
  if (Math.abs(polygonSignedArea) <= epsilon) {
    const sum = points.reduce(
      (result, value) => ({ x: result.x + value.x, y: result.y + value.y }),
      { x: 0, y: 0 }
    )
    return point(sum.x / points.length, sum.y / points.length)
  }

  let x = 0
  let y = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const factor = current.x * next.y - next.x * current.y
    x += (current.x + next.x) * factor
    y += (current.y + next.y) * factor
  }
  const divisor = 6 * polygonSignedArea
  return point(x / divisor, y / divisor)
}

module.exports = {
  area,
  assertPolygon,
  centroid,
  signedArea,
}
