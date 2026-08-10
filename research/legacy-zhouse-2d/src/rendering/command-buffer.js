'use strict'

const { assertPoint, point } = require('../geometry/point')

const COMMAND_TYPES = new Set(['line', 'polygon', 'text'])

function createCommandBuffer(metadata = {}) {
  return { schema: 'legacy-zhouse-2d-render-plan/v1', metadata: { ...metadata }, commands: [] }
}

function appendCommand(buffer, command) {
  if (!buffer || buffer.schema !== 'legacy-zhouse-2d-render-plan/v1' || !Array.isArray(buffer.commands)) {
    throw new TypeError('invalid render command buffer')
  }
  validateCommand(command)
  return { ...buffer, commands: [...buffer.commands, structuredClone(command)] }
}

function validateCommand(command) {
  if (!command || !COMMAND_TYPES.has(command.type)) {
    throw new TypeError('unsupported render command type')
  }
  if (command.type === 'line') {
    assertPoint(command.start, 'command.start')
    assertPoint(command.end, 'command.end')
  } else if (command.type === 'polygon') {
    if (!Array.isArray(command.points) || command.points.length < 3) {
      throw new TypeError('polygon command requires at least three points')
    }
    command.points.forEach((value, index) => assertPoint(value, `command.points[${index}]`))
  } else {
    assertPoint(command.position, 'command.position')
    if (typeof command.text !== 'string') throw new TypeError('text command requires text')
  }
}

function lineCommand(start, end, style = {}) {
  assertPoint(start, 'start')
  assertPoint(end, 'end')
  return { type: 'line', start: point(start.x, start.y), end: point(end.x, end.y), style: { ...style } }
}

module.exports = {
  appendCommand,
  createCommandBuffer,
  lineCommand,
  validateCommand,
}
