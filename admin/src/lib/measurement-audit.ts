export const MAX_MEASUREMENT_AUDIT_ID_LENGTH = 200;

export class MeasurementAuditInputError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'MeasurementAuditInputError';
  }
}

export function resolveMeasurementAuditInput(body: {
  auditId?: unknown;
  metadata?: unknown;
}) {
  const metadata = body.metadata && typeof body.metadata === 'object'
    ? body.metadata as Record<string, unknown>
    : {};
  const rawAuditId = body.auditId !== undefined && body.auditId !== null
    ? body.auditId
    : metadata.auditId;

  if (rawAuditId !== undefined && rawAuditId !== null && typeof rawAuditId !== 'string') {
    throw new MeasurementAuditInputError('auditId must be a string');
  }

  const normalized = typeof rawAuditId === 'string' ? rawAuditId.trim() : '';
  if (normalized.length > MAX_MEASUREMENT_AUDIT_ID_LENGTH) {
    throw new MeasurementAuditInputError('auditId is too long');
  }
  if (metadata.measurementMode === 'surveying' && !normalized) {
    throw new MeasurementAuditInputError(
      'auditId is required for formal surveying measurements'
    );
  }

  return {
    auditId: normalized || null,
    metadata,
  };
}
