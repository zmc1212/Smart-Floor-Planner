export type HttpError = Error & { status: number };

export function httpError(message: string, status: number): HttpError {
  return Object.assign(new Error(message), { status });
}

export function httpErrorStatus(error: unknown, fallback: number) {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : fallback;
}
