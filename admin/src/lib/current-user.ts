export type CurrentUser = {
  _id?: string;
  username?: string;
  displayName?: string;
  role?: string;
  enterpriseId?: { _id?: string; name?: string } | null;
  effectivePermissions?: string[];
  workbenchType?: string;
};

type CurrentUserPayload = {
  success?: boolean;
  error?: string;
  data?: CurrentUser;
};

export function parseCurrentUserResponse(
  payload: CurrentUserPayload | undefined
): CurrentUser | null {
  if (!payload?.success || !payload.data) return null;
  return payload.data;
}

export async function fetchCurrentUserJson(
  url: string,
  fetchImpl: typeof fetch = fetch
) {
  const res = await fetchImpl(url);
  const payload = (await res.json()) as CurrentUserPayload;
  if (!res.ok || !payload?.success) {
    const error = new Error(payload?.error || '未登录') as Error & {
      status: number;
    };
    error.status = res.status;
    throw error;
  }
  return payload;
}

export function shouldRetryCurrentUserError(error: unknown) {
  return (error as { status?: number }).status !== 401;
}
