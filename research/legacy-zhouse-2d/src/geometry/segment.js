'use strict'

const {
  DEFAULT_EPSILON,
  add,
  almostEqual,
  assertFiniteNumber,
  assertPoint,
  cross,
  distance,
  dot,
  point,
  scale,
  subtract,
} = require('./point')

function segment(start, end) {
  assertPoint(start, 'start')
  assertPoint(end, 'end')
  return { start: point(start.x, start.y), end: point(end.x, end.y) }
}

function length(value) {
  assertSegment(value)
  return distance(value.start, value.end)
}

function assertSegment(value, name = 'segment') {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${name} must be an object`)
  }
  assertPoint(value.start, `${name}.start`)
  assertPoint(value.end, `${name}.end`)
  return value
}

function pointAt(value, ratio) {
  assertSegment(value)
  assertFiniteNumber(ratio, 'ratio')
  return add(value.start, scale(subtract(value.end, value.start), ratio))
}

function pointOnSegment(candidate, value, epsilon = DEFAULT_EPSILON) {
  assertPoint(candidate, 'candidate')
  assertSegment(value)
  const direction = subtract(value.end, value.start)
  const relative = subtract(candidate, value.start)
  const directionLengthSquared = dot(direction, direction)

  if (directionLengthSquared <= epsilon * epsilon) {
    return almostEqual(candidate, value.start, epsilon)
  }

  if (Math.abs(cross(relative, direction)) > epsilon * Math.sqrt(directionLengthSquared)) {
    return false
  }

  const projection = dot(relative, direction)
  const projectionTolerance = epsilon * Math.sqrt(directionLengthSquared)
  return projection >= -projectionTolerance && projection <= directionLengthSquared + projectionTolerance
}

function noneIntersection() {
  return { kind: 'none' }
}

function pointIntersection(value, t, u) {
  return { kind: 'point', point: value, t, u }
}

function intersectSegments(first, second, options = {}) {
  assertSegment(first, 'first')
  assertSegment(second, 'second')
  const epsilon = options.epsilon ?? DEFAULT_EPSILON
  assertFiniteNumber(epsilon, 'epsilon')

  const p = first.start
  const q = second.start
  const r = subtract(first.end, first.start)
  const s = subtract(second.end, second.start)
  const rLengthSquared = dot(r, r)
  const sLengthSquared = dot(s, s)

  if (rLengthSquared <= epsilon * epsilon && sLengthSquared <= epsilon * epsilon) {
    return almostEqual(p, q, epsilon) ? pointIntersection(point(p.x, p.y), 0, 0) : noneIntersection()
  }
  if (rLengthSquared <= epsilon * epsilon) {
    if (!pointOnSegment(p, second, epsilon)) return noneIntersection()
    const u = sLengthSquared <= epsilon * epsilon ? 0 : dot(subtract(p, q), s) / sLengthSquared
    return pointIntersection(point(p.x, p.y), 0, u)
  }
  if (sLengthSquared <= epsilon * epsilon) {
    if (!pointOnSegment(q, first, epsilon)) return noneIntersection()
    const t = dot(subtract(q, p), r) / rLengthSquared
    return pointIntersection(point(q.x, q.y), t, 0)
  }

  const qMinusP = subtract(q, p)
  const rCrossS = cross(r, s)
  const qMinusPCrossR = cross(qMinusP, r)
  const parallelTolerance = epsilon * Math.sqrt(rLengthSquared * sLengthSquared)
  const collinearTolerance = epsilon * Math.sqrt(rLengthSquared)

  if (Math.abs(rCrossS) <= parallelTolerance) {
    if (Math.abs(qMinusPCrossR) > collinearTolerance) return noneIntersection()

    const t0 = dot(qMinusP, r) / rLengthSquared
    const t1 = t0 + dot(s, r) / rLengthSquared
    const startRatio = Math.max(0, Math.min(t0, t1))
    const endRatio = Math.min(1, Math.max(t0, t1))

    if (endRatio < startRatio - epsilon) return noneIntersection()
    if (Math.abs(endRatio - startRatio) <= epsilon) {
      const clampedRatio = Math.max(0, Math.min(1, startRatio))
      const intersectionPoint = pointAt(first, clampedRatio)
      const u = dot(subtract(intersectionPoint, q), s) / sLengthSquared
      return pointIntersection(intersectionPoint, clampedRatio, u)
    }

    return {
      kind: 'overlap',
      segment: segment(pointAt(first, startRatio), pointAt(first, endRatio)),
      firstRange: [startRatio, endRatio],
    }
  }

  const t = cross(qMinusP, s) / rCrossS
  const u = cross(qMinusP, r) / rCrossS
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) {
    return noneIntersection()
  }

  return pointIntersection(pointAt(first, t), t, u)
}

module.exports = {
  assertSegment,
  intersectSegments,
  length,
  pointAt,
  pointOnSegment,
  segment,
}
