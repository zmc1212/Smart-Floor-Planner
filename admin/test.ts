import * as jose from 'jose';

async function test() {
  const secret = new TextEncoder().encode('fallback_secret_random_123');
  const token = await new jose.SignJWT({
    id: '123',
    role: 'super_admin',
    username: 'admin'
  })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secret);

  const cookie = `auth_token=${token}; global_tenant_id=661bb0e932906bbaec43b184`;
  const globalTenantMatch = cookie?.match(/global_tenant_id=([^;]+)/);
  const globalTenantId = globalTenantMatch ? globalTenantMatch[1] : null;
  console.log("Global tenant ID matched:", globalTenantId);
}
test();
