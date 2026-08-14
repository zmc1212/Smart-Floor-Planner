function createSpaceDimensionReadModel(kernel) {
  return {
    buildSpaceDimensionPlan: kernel.buildSpaceDimensionPlan,
    calculateSpaceAreaMm2: kernel.calculateSpaceAreaMm2
  };
}

module.exports = { createSpaceDimensionReadModel };
