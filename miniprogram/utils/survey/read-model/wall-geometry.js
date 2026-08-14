function createWallGeometryReadModel(kernel) {
  return {
    buildWallSnapGeometry: kernel.buildWallSnapGeometry,
    buildWallRenderGeometry: kernel.buildWallRenderGeometry,
    buildWallJoinRenderGeometries: kernel.buildWallJoinRenderGeometries
  };
}

module.exports = { createWallGeometryReadModel };
