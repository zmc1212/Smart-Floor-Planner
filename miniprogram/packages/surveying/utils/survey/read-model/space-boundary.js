function createSpaceBoundaryReadModel(kernel) {
  return {
    buildSpaceBoundaryPoints: kernel.buildSpaceBoundaryPoints,
    buildSpaceInnerBoundaryPoints: kernel.buildSpaceInnerBoundaryPoints,
    buildSpaceRenderBoundaryPoints: kernel.buildSpaceRenderBoundaryPoints
  };
}

module.exports = { createSpaceBoundaryReadModel };
