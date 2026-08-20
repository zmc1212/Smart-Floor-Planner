function createWallGeometryReadModel(kernel) {
  const wallFaces = require('./wall-faces.js');
  return {
    buildWallSnapGeometry: kernel.buildWallSnapGeometry,
    buildWallRenderGeometry: kernel.buildWallRenderGeometry,
    buildWallJoinRenderGeometries: kernel.buildWallJoinRenderGeometries,
    projectWallFaces: wallFaces.projectWallFaces,
    projectWorkingFace: wallFaces.projectWorkingFace,
    measuredReadingMm: wallFaces.measuredReadingMm,
    resolveBodyNormal: wallFaces.resolveBodyNormal
  };
}

module.exports = { createWallGeometryReadModel };
