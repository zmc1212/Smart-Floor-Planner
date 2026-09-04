import { randomUUID } from 'node:crypto';

type RequestStage =
  | 'received'
  | 'parse_body'
  | 'authenticate'
  | 'password_login'
  | 'wechat_code'
  | 'wechat_phone'
  | 'refresh'
  | 'staff_setup'
  | 'database'
  | 'sign_token'
  | 'assignment_retry'
  | 'badges';

export interface MiniProgramRequestLog {
  stage(value: RequestStage): void;
  error(error: unknown): void;
}

// Drizzle errors can contain the entire SQL statement and its bound parameters.
// Keep diagnostic codes and source locations, never messages, detail, or params.
function errorDiagnostics(error: unknown) {
  const causes: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current) && causes.length < 5) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    const code = typeof value.code === 'number' && Number.isSafeInteger(value.code)
      ? value.code
      : typeof value.code === 'string' && /^[A-Z0-9_]{2,64}$/.test(value.code)
        ? value.code
        : undefined;
    const locations = typeof value.stack === 'string'
      ? value.stack.split('\n').filter((line) => /^\s+at /.test(line)).flatMap((line) => {
          const match = line.match(/(?:\(|\s)((?:file:\/\/\/|[A-Za-z]:[\\/]|\/)[^\s()?]+\.(?:[cm]?js|tsx?):\d+:\d+)\)?\s*$/);
          return match ? [match[1]] : [];
        }).slice(0, 4)
      : [];
    causes.push({
      name: typeof value.name === 'string' && /^[A-Za-z][A-Za-z0-9]*Error$|^Error$/.test(value.name)
        ? value.name
        : 'Error',
      ...(code !== undefined ? { code } : {}),
      ...(locations.length ? { locations } : {}),
    });
    current = value.cause;
  }
  return causes.length ? causes : [{ name: 'UnknownError' }];
}

/** Logs only this explicitly opted-in route, never request bodies or query strings. */
export async function withMiniProgramRequestLog(
  request: Request,
  route: string,
  handler: (log: MiniProgramRequestLog) => Promise<Response>
): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = performance.now();
  let stage: RequestStage = 'received';
  const write = (level: 'info' | 'warn' | 'error', event: string, fields = {}) => {
    console[level]('[MiniProgramRequest]', JSON.stringify({
      event,
      requestId,
      method: request.method,
      route,
      stage,
      durationMs: Math.round(performance.now() - startedAt),
      ...fields,
    }));
  };
  const log: MiniProgramRequestLog = {
    stage(value) { stage = value; },
    error(error) { write('error', 'exception', { causes: errorDiagnostics(error) }); },
  };

  write('info', 'start');
  try {
    const response = await handler(log);
    // These routes return bounded JSON DTOs. Clone so callers receive the original body.
    const body = await response.clone().json().catch(() => null);
    const result = typeof body?.code === 'string' && /^[a-z]+(?:_[a-z]+)*$/.test(body.code) && body.code.length <= 80
      ? body.code
      : body?.success === true ? 'ok' : 'http_error';
    response.headers.set('X-Request-Id', requestId);
    write(response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info', 'complete', {
      status: response.status,
      result,
    });
    return response;
  } catch (error) {
    log.error(error);
    write('error', 'failed');
    throw error;
  }
}
