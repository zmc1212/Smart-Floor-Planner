/** Construction identities have no implicit lead, finance or survey capability. */
export function constructionRouteAllowed(pathname: string, miniProgram: boolean) {
  const exact = miniProgram ? [
    '/api/auth/miniprogram', '/api/miniprogram/bootstrap', '/api/miniprogram/identity-contexts',
    '/api/miniprogram/identity-contexts/switch', '/api/miniprogram/profile', '/api/miniprogram/mine',
    '/api/miniprogram/profile/avatar', '/api/miniprogram/account/password',
    '/api/miniprogram/onboarding/staff', '/api/miniprogram/codes/resolve',
  ] : ['/api/auth/me', '/api/auth/password', '/api/auth/logout', '/construction-projects', '/change-password', '/login'];
  const root = miniProgram ? '/api/miniprogram/construction' : '/api/construction';
  return exact.includes(pathname) || pathname === root || pathname.startsWith(root + '/')
    || (miniProgram && /^\/api\/miniprogram\/profile\/avatar\/[1-9]\d*$/.test(pathname))
    || (miniProgram && /^\/api\/branding\/[1-9]\d*$/.test(pathname));
}
