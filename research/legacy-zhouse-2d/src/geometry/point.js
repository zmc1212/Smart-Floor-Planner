'use strict'

const DEFAULT_EPSILON = 1e-9

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`)
  }
}

function point(x, y) {
  assertFiniteNumber(x, 'x')
  assertFiniteNumber(y, 'y')
  return { x, y }
}

function assertPoint(value, name = 'point') {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${name} must be an object`)
  }
  assertFiniteNumber(value.x, `${name}.x`)
  assertFiniteNumber(value.y, `${name}.y`)
  return value
}

function add(a, b) {
  assertPoint(a, 'a')
  assertPoint(b, 'b')
  return point(a.x + b.x, a.y + b.y)
}

function subtract(a, b) {
  assertPoint(a, 'a')
  assertPoint(b, 'b')
  return point(a.x - b.x, a.y - b.y)
}

function scale(value, factor) {
  assertPoint(value)
  assertFiniteNumber(factor, 'factor')
  return point(value.x * factor, value.y * factor)
}

function dot(a, b) {
  assertPoint(a, 'a')
  assertPoint(b, 'b')
  return a.x * b.x + a.y * b.y
}

function cross(a, b) {
  assertPoint(a, 'a')
  assertPoint(b, 'b')
  return a.x * b.y - a.y * b.x
}

function magnitude(value) {
  assertPoint(value)
  return Math.hypot(value.x, value.y)
}

function distance(a, b) {
  return magnitude(subtract(b, a))
}

function normalize(value, epsilon = DEFAULT_EPSILON) {
  assertPoint(value)
  assertFiniteNumber(epsilon, 'epsilon')
  const length = magnitude(value)
  if (length <= epsilon) {
    throw new RangeError('cannot normalize a zero-length vector')
  }
  return scale(value, 1 / length)
}

function leftNormal(value, epsilon = DEFAULT_EPSILON) {
  const unit = normalize(value, epsilon)
  return point(-unit.y, unit.x)
}

function almostEqual(a, b, epsilon = DEFAULT_EPSILON) {
  assertPoint(a, 'a')
  assertPoint(b, 'b')
  assertFiniteNumber(epsilon, 'epsilon')
  return distance(a, b) <= epsilon
}

module.exports = {
  DEFAULT_EPSILON,
  add,
  almostEqual,
  assertFiniteNumber,
  assertPoint,
  cross,
  distance,
  dot,
  leftNormal,
  magnitude,
  normalize,
  point,
  scale,
  subtract,
}
