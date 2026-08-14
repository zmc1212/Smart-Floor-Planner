'use strict'

module.exports = {
  differential: {
    ...require('./differential/canonicalize'),
    runtimeStateTransition: require('./differential/runtime-state-transition'),
    runtimeTrace: require('./differential/runtime-trace'),
  },
  engine: require('./engine/reconstruction-engine'),
  geometry: {
    rectangularInsideWall: require('./geometry/rectangular-inside-wall'),
    point: require('./geometry/point'),
    polygon: require('./geometry/polygon'),
    segment: require('./geometry/segment'),
    wallFaces: require('./geometry/wall-faces'),
  },
  model: require('./model/house-state'),
  orchestration: require('./orchestration/core-editing'),
  rendering: require('./rendering/command-buffer'),
}
