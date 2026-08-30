async function requestFormalFloorPlanSave(options) {
  const request = options && options.request;
  if (typeof request !== 'function') {
    throw new TypeError('Formal floor-plan request function is required');
  }

  const floorPlanId = options.floorPlanId;
  const payload = options.payload;
  if (floorPlanId) {
    return request(`/floorplans/${floorPlanId}`, 'PUT', payload);
  }

  const idempotencyKey = options.idempotencyKey;
  return request('/floorplans', 'POST', payload, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
  });
}

module.exports = { requestFormalFloorPlanSave };
