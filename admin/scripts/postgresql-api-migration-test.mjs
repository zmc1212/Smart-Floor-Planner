import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import nextEnv from '@next/env';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const { Pool } = pg;
const baseUrl = process.env.API_TEST_BASE_URL || 'http://localhost:3005';
const runKey = `codex-api-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`;
const outputPath = resolve(
  process.cwd(),
  '..',
  'output',
  `postgresql-api-test-results-${runKey}.json`
);
const routeRoot = resolve(process.cwd(), 'src', 'app', 'api');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const results = [];
const resources = {};
const cleanup = [];
const cleanupResults = [];

let platformCookie = '';
let tenantCookie = '';
let miniToken = '';

function valueAt(body, path) {
  return path.split('.').reduce((value, key) => value?.[key], body);
}

function is2xx(status) {
  return status >= 200 && status < 300;
}

async function request(method, path, options = {}) {
  const startedAt = performance.now();
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.session === 'platform' && platformCookie) headers.Cookie = platformCookie;
  if (options.session === 'tenant' && tenantCookie) headers.Cookie = tenantCookie;
  if (options.session === 'mini' && miniToken) headers.Authorization = `Bearer ${miniToken}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  let text;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs || 20_000),
    });
    text = await response.text();
  } catch (error) {
    return {
      method,
      path,
      status: 0,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
      body: null,
      rawBody: '',
      setCookie: '',
    };
  }
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return {
    method,
    path,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
    error: null,
    body,
    rawBody: text.slice(0, 1000),
    setCookie: response.headers.get('set-cookie') || '',
  };
}

async function check(name, method, path, options = {}) {
  const response = await request(method, path, options);
  const expectedStatuses = options.expectedStatuses || [200];
  const requiredPath = options.requiredPath;
  const passed =
    expectedStatuses.includes(response.status) &&
    (!requiredPath || valueAt(response.body, requiredPath) !== undefined);
  const item = {
    name,
    category: options.category || 'scenario',
    method,
    path,
    session: options.session || 'public',
    status: response.status,
    durationMs: response.durationMs,
    expectedStatuses,
    passed,
    requiredPath: requiredPath || null,
    responseSummary:
      response.error ||
      response.body?.error ||
      response.body?.message ||
      (response.body?.success === true ? 'success=true' : response.rawBody.slice(0, 240)),
  };
  results.push(item);
  if (!passed && options.fatal !== false) {
    throw new Error(`${name} failed: ${method} ${path} -> ${response.status} ${item.responseSummary}`);
  }
  return response;
}

function idFrom(response, ...paths) {
  for (const path of paths) {
    const value = valueAt(response.body, path);
    if (value !== undefined && value !== null) return String(value);
  }
  throw new Error(`Response did not contain an id: ${response.rawBody}`);
}

function cookieFrom(setCookie) {
  return setCookie.split(';', 1)[0];
}

async function walkRoutes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkRoutes(path)));
    else if (entry.name === 'route.ts') files.push(path);
  }
  return files;
}

async function discoverRoutes() {
  const files = await walkRoutes(routeRoot);
  const routes = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const methods = new Set();
    for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
      methods.add(match[1]);
    }
    for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
      for (const method of match[1].match(/\b(GET|POST|PUT|PATCH|DELETE)\b/g) || []) methods.add(method);
    }
    const relativePath = relative(routeRoot, file).split(sep).join('/').replace(/\/route\.ts$/, '');
    for (const method of methods) routes.push({ method, template: `/api/${relativePath}`, file: relative(process.cwd(), file).split(sep).join('/') });
  }
  return routes.sort((a, b) => `${a.template}:${a.method}`.localeCompare(`${b.template}:${b.method}`));
}

function resolveDynamicPath(template) {
  let path = template;
  const providerResourceId = template === '/api/admin/ai-providers/[id]' ? resources.providerId : undefined;
  const prefixMap = [
    ['/api/admin/enterprises/', resources.enterpriseId],
    ['/api/admin/packages/', resources.packageId],
    ['/api/admin-users/', resources.adminUserId],
    ['/api/departments/', resources.departmentId],
    ['/api/staff/', resources.staffId],
    ['/api/devices/', resources.deviceId],
    ['/api/leads/', resources.leadId],
    ['/api/floorplans/', resources.floorPlanId],
    ['/api/promotion-records/', resources.promotionRecordId],
    ['/api/enterprise-orders/', resources.orderId],
    ['/api/commission-records/', resources.commissionId],
    ['/api/commissions/', resources.commissionId],
    ['/api/ai/conversations/', resources.conversationId],
    ['/api/admin/ai-providers/', providerResourceId],
  ];
  const mapped = prefixMap.find(([prefix]) => path.startsWith(prefix))?.[1];
  path = path.replace('[openid]', encodeURIComponent(resources.openid || `${runKey}-openid`));
  path = path.replace(/\[id\]/g, mapped || '999999999999999999');
  return path;
}

function smokeSession(template) {
  if (template.startsWith('/api/miniprogram/')) return 'mini';
  if (template.startsWith('/api/users/')) return 'mini';
  if (template.startsWith('/api/admin/')) return 'platform';
  if (template.startsWith('/api/auth/')) return 'public';
  if (template.startsWith('/api/save-icons') || template.startsWith('/api/health')) return 'public';
  return 'tenant';
}

function smokeBody(template, method) {
  if (method === 'GET' || method === 'DELETE') return undefined;
  if (template === '/api/auth/login') return { username: '', password: '' };
  if (template === '/api/auth/miniprogram') return { type: 'invalid' };
  if (template === '/api/auth/register-enterprise' || template === '/api/auth/register-company') return {};
  if (template === '/api/internal/seed') return {};
  if (template === '/api/roles') return { id: '0', menuKeys: [] };
  if (template === '/api/platform/promotion-config') return {};
  if (template === '/api/admin/media-storage') return {};
  return {};
}

function classifySmoke(response) {
  if (response.status === 0) return { passed: false, verdict: 'network-error' };
  if (response.status === 405) return { passed: false, verdict: 'route-unreachable' };
  if (response.status === 404) return { passed: true, verdict: 'expected-not-found' };
  if (response.status === 503) return { passed: true, verdict: 'blocked-by-local-configuration' };
  if (response.status >= 500) return { passed: false, verdict: 'server-error' };
  if (response.status >= 200 && response.status < 500) return { passed: true, verdict: is2xx(response.status) ? 'success' : 'expected-client-rejection' };
  return { passed: false, verdict: 'unexpected-status' };
}

async function setupPlatformAdmin() {
  const username = `${runKey}-platform`;
  const password = `T!${runKey}Aa9`;
  const passwordHash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  let inserted;
  try {
    await client.query('begin');
    await client.query(
      `select set_config('app.current_enterprise_id', '', true), set_config('app.is_platform_admin', 'true', true)`
    );
    inserted = await client.query(
      `insert into app.admin_users
        (username, password_hash, display_name, role, menu_permissions, status)
       values ($1, $2, $3, 'super_admin', array[]::text[], 'active')
       returning id`,
      [username, passwordHash, 'Codex API Migration Test']
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  resources.platformAdminId = inserted.rows[0].id.toString();
  cleanup.push(async () => {
    const cleanupClient = await pool.connect();
    try {
      await cleanupClient.query('begin');
      await cleanupClient.query(
        `select set_config('app.current_enterprise_id', '', true), set_config('app.is_platform_admin', 'true', true)`
      );
      await cleanupClient.query('delete from app.admin_users where id = $1', [resources.platformAdminId]);
      await cleanupClient.query('commit');
    } catch (error) {
      await cleanupClient.query('rollback');
      throw error;
    } finally {
      cleanupClient.release();
    }
  });
  return { username, password };
}

async function runCoreScenarios(credentials) {
  await check('PostgreSQL health endpoint', 'GET', '/api/health', { expectedStatuses: [200], requiredPath: 'databases.postgresql.status' });
  await check('Invalid login is rejected', 'POST', '/api/auth/login', {
    body: { username: credentials.username, password: 'wrong-password' },
    expectedStatuses: [401],
  });
  const login = await check('Platform administrator login', 'POST', '/api/auth/login', {
    body: credentials,
    expectedStatuses: [200],
    requiredPath: 'data.role',
  });
  platformCookie = cookieFrom(login.setCookie);
  await check('Current platform session', 'GET', '/api/auth/me', { session: 'platform', expectedStatuses: [200], requiredPath: 'data.role' });

  // Public authorization probes intentionally expect rejection. They expose routes that skipped auth entirely.
  await check('Admin user list rejects unauthenticated access', 'GET', '/api/admin-users', {
    expectedStatuses: [401, 403], category: 'security', fatal: false,
  });
  await check('User list rejects unauthenticated access', 'GET', '/api/users?limit=1', {
    expectedStatuses: [401, 403], category: 'security', fatal: false,
  });

  const stamp = Date.now().toString().slice(-8);
  const enterprisePhone = `139${stamp}`;
  const enterprise = await check('Create enterprise', 'POST', '/api/admin/enterprises', {
    session: 'platform', body: {
      name: `${runKey} Enterprise`, code: runKey, status: 'active',
      contactPerson: { name: 'API Test Tenant Admin', phone: enterprisePhone },
      address: 'Codex isolated API test data', industry: 'software', description: runKey,
    }, expectedStatuses: [200, 201], requiredPath: 'data._id',
  });
  resources.enterpriseId = idFrom(enterprise, 'data._id', 'data.id');
  await check('List enterprises', 'GET', '/api/admin/enterprises', { session: 'platform', expectedStatuses: [200], requiredPath: 'data' });
  await check('Read enterprise', 'GET', `/api/admin/enterprises/${resources.enterpriseId}`, { session: 'platform', expectedStatuses: [200], requiredPath: 'data._id' });
  await check('Update enterprise', 'PATCH', `/api/admin/enterprises/${resources.enterpriseId}`, {
    session: 'platform', body: { name: `${runKey} Enterprise Updated`, status: 'active' }, expectedStatuses: [200], requiredPath: 'data._id',
  });

  const tenantLogin = await check('Tenant administrator login', 'POST', '/api/auth/login', {
    body: { username: enterprisePhone, password: '123456' }, expectedStatuses: [200], requiredPath: 'data.role',
  });
  tenantCookie = cookieFrom(tenantLogin.setCookie);
  const miniLogin = await check('Mini Program password login', 'POST', '/api/auth/miniprogram', {
    body: { type: 'password', username: enterprisePhone, password: '123456' }, expectedStatuses: [200], requiredPath: 'token',
  });
  miniToken = String(miniLogin.body.token);
  resources.openid = String(miniLogin.body.openid || `${runKey}-openid`);

  const packageCreate = await check('Create package', 'POST', '/api/admin/packages', {
    session: 'platform', body: { name: `${runKey} Package`, price: 99.01, promotionCommission: 5.25, features: ['api-test'], status: 'active' },
    expectedStatuses: [201], requiredPath: 'data._id',
  });
  resources.packageId = idFrom(packageCreate, 'data._id', 'data.id');
  await check('List packages', 'GET', '/api/admin/packages', { session: 'platform', expectedStatuses: [200], requiredPath: 'data' });
  await check('Update package', 'PUT', `/api/admin/packages/${resources.packageId}`, {
    session: 'platform', body: { price: 101.23, description: 'updated by migration API test' }, expectedStatuses: [200], requiredPath: 'data._id',
  });

  const adminUser = await check('Create platform admin user', 'POST', '/api/admin-users', {
    session: 'platform', body: {
      username: `${runKey}-viewer`, password: 'ApiTest123456!', displayName: 'API Test Viewer',
      phone: `138${(Number(stamp) + 1).toString().padStart(8, '0').slice(-8)}`, role: 'viewer',
    }, expectedStatuses: [201], requiredPath: 'data._id',
  });
  resources.adminUserId = idFrom(adminUser, 'data._id', 'data.id');
  await check('Update platform admin user', 'PATCH', `/api/admin-users/${resources.adminUserId}`, {
    session: 'platform', body: { displayName: 'API Test Viewer Updated' }, expectedStatuses: [200], requiredPath: 'data._id',
  });

  const department = await check('Create department', 'POST', '/api/departments', {
    session: 'tenant', body: { name: `${runKey} Department`, order: 7 }, expectedStatuses: [201], requiredPath: 'data._id',
  });
  resources.departmentId = idFrom(department, 'data._id', 'data.id');
  await check('List departments', 'GET', '/api/departments', { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });
  await check('Update department', 'PUT', `/api/departments/${resources.departmentId}`, {
    session: 'tenant', body: { name: `${runKey} Department Updated`, order: 8 }, expectedStatuses: [200], requiredPath: 'data._id',
  });

  const salesperson = await check('Create tenant salesperson', 'POST', '/api/staff', {
    session: 'tenant', body: {
      username: `${runKey}-sales`, password: 'ApiTest123456!', displayName: 'API Test Sales', role: 'salesperson',
      phone: `137${(Number(stamp) + 2).toString().padStart(8, '0').slice(-8)}`, departmentId: resources.departmentId,
    }, expectedStatuses: [201], requiredPath: 'data._id',
  });
  resources.staffId = idFrom(salesperson, 'data._id', 'data.id');
  await check('List staff', 'GET', '/api/staff', { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });
  await check('Update staff', 'PUT', `/api/staff/${resources.staffId}`, {
    session: 'tenant', body: { displayName: 'API Test Sales Updated', departmentId: resources.departmentId }, expectedStatuses: [200], requiredPath: 'data._id',
  });

  const device = await check('Create device', 'POST', '/api/devices', {
    session: 'tenant', body: { code: `${runKey}-laser`, description: 'API migration test', assignedUserId: resources.staffId, status: 'assigned' },
    expectedStatuses: [201], requiredPath: 'data._id',
  });
  resources.deviceId = idFrom(device, 'data._id', 'data.id');
  await check('List devices', 'GET', '/api/devices', { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });
  await check('Update device', 'PATCH', `/api/devices/${resources.deviceId}`, {
    session: 'tenant', body: { description: 'API migration test updated', status: 'maintenance' }, expectedStatuses: [200], requiredPath: 'data._id',
  });

  const user = await check('Create Mini Program user record', 'POST', '/api/users', {
    session: 'tenant', body: { enterpriseId: resources.enterpriseId, openid: `${runKey}-user`, nickname: 'API Test User', phone: `136${(Number(stamp) + 3).toString().padStart(8, '0').slice(-8)}` },
    expectedStatuses: [201], requiredPath: 'data._id',
  });
  resources.userId = idFrom(user, 'data._id', 'data.id');
  await check('List Mini Program users', 'GET', `/api/users?search=${encodeURIComponent(runKey)}`, { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });
  await check('Read current Mini Program user', 'GET', '/api/users/me', { session: 'mini', expectedStatuses: [200], requiredPath: 'data' });
  await check('Update current Mini Program user', 'PUT', '/api/users/me', {
    session: 'mini', body: { nickname: 'API Test Tenant Admin Updated', city: 'Shanghai' }, expectedStatuses: [200], requiredPath: 'data',
  });

  const lead = await check('Create lead', 'POST', '/api/leads', {
    session: 'tenant', body: { name: 'API Test Lead', phone: `135${(Number(stamp) + 4).toString().padStart(8, '0').slice(-8)}`, source: 'api-migration-test', communityName: runKey, area: 88 },
    expectedStatuses: [201], requiredPath: 'data._id',
  });
  resources.leadId = idFrom(lead, 'data._id', 'data.id');
  await check('List leads', 'GET', `/api/leads?search=${encodeURIComponent(runKey)}`, { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });
  await check('Read lead', 'GET', `/api/leads/${resources.leadId}`, { session: 'tenant', expectedStatuses: [200], requiredPath: 'data._id' });
  await check('Update lead', 'PUT', `/api/leads/${resources.leadId}`, {
    session: 'tenant', body: { status: 'contacted', notes: 'updated by migration API test' }, expectedStatuses: [200], requiredPath: 'data._id',
  });

  const layoutData = {
    version: 4,
    measurementMode: 'surveying',
    surveyGraph: { kind: 'survey-wall-graph', activeFloorId: 'floor-1', floors: [{ id: 'floor-1', nodes: [], walls: [], spaces: [] }] },
  };
  const floorPlan = await check('Create formal floor plan', 'POST', '/api/floorplans', {
    session: 'mini', body: { name: `${runKey} Floor Plan`, layoutData, status: 'draft', leadId: resources.leadId },
    expectedStatuses: [201], requiredPath: 'data._id',
  });
  resources.floorPlanId = idFrom(floorPlan, 'data._id', 'data.id');
  await check('List floor plans', 'GET', '/api/floorplans', { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });
  await check('Read floor plan', 'GET', `/api/floorplans/${resources.floorPlanId}`, { session: 'mini', expectedStatuses: [200], requiredPath: 'data._id' });
  await check('Update floor plan', 'PUT', `/api/floorplans/${resources.floorPlanId}`, {
    session: 'mini', body: { name: `${runKey} Floor Plan Updated`, layoutData, status: 'completed', leadId: resources.leadId }, expectedStatuses: [200], requiredPath: 'data._id',
  });

  const measurement = await check('Create measurement', 'POST', '/api/measurements', {
    session: 'mini', body: { floorPlanId: resources.floorPlanId, value: 2450, unit: 'millimeters', type: 'length', source: 'manual', roomId: 'room-1' },
    expectedStatuses: [201], requiredPath: 'data._id',
  });
  resources.measurementId = idFrom(measurement, 'data._id', 'data.id');
  await check('List measurements', 'GET', `/api/measurements?floorPlanId=${resources.floorPlanId}`, { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });

  const inspiration = await check('Create inspiration', 'POST', '/api/inspirations', {
    session: 'tenant', body: { title: `${runKey} Inspiration`, coverImage: 'https://example.test/cover.png', renderingImage: 'https://example.test/render.png', style: 'modern', roomType: 'living-room', layoutData, isRecommended: false },
    expectedStatuses: [201], requiredPath: 'data._id',
  });
  resources.inspirationId = idFrom(inspiration, 'data._id', 'data.id');
  await check('List inspirations', 'GET', '/api/inspirations?limit=10', { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });

  const promotion = await check('Create promotion record', 'POST', '/api/promotion-records', {
    session: 'tenant', body: { enterpriseId: resources.enterpriseId, promoterId: resources.staffId, enterpriseName: `${runKey} Prospect`, contactPerson: 'API Test Contact', phone: `134${(Number(stamp) + 5).toString().padStart(8, '0').slice(-8)}`, notes: runKey },
    expectedStatuses: [200, 201], requiredPath: 'data._id',
  });
  resources.promotionRecordId = idFrom(promotion, 'data._id', 'data.id');
  await check('List promotion records', 'GET', `/api/promotion-records?search=${encodeURIComponent(runKey)}`, { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });
  await check('Read promotion record', 'GET', `/api/promotion-records/${resources.promotionRecordId}`, { session: 'tenant', expectedStatuses: [200], requiredPath: 'data._id' });
  await check('Update promotion record', 'PUT', `/api/promotion-records/${resources.promotionRecordId}`, {
    session: 'tenant', body: { notes: `${runKey} updated` }, expectedStatuses: [200], requiredPath: 'data._id',
  });

  const order = await check('Create enterprise order', 'POST', '/api/enterprise-orders', {
    session: 'tenant', body: { recordId: resources.promotionRecordId, packageName: `${runKey} Service`, amount: 199.99, status: 'draft', remark: runKey },
    expectedStatuses: [201], requiredPath: 'data._id',
  });
  resources.orderId = idFrom(order, 'data._id', 'data.id');
  await check('List enterprise orders', 'GET', '/api/enterprise-orders', { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });
  await check('Update enterprise order', 'PUT', `/api/enterprise-orders/${resources.orderId}`, {
    session: 'tenant', body: { amount: 209.99, remark: `${runKey} updated` }, expectedStatuses: [200], requiredPath: 'data._id',
  });
  const commissions = await check('List commissions', 'GET', '/api/commissions', { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });
  const commission = Array.isArray(commissions.body?.data)
    ? commissions.body.data.find((item) => String(item.orderId?._id || item.orderId || '') === resources.orderId)
    : null;
  if (commission) {
    resources.commissionId = String(commission._id || commission.id);
    await check('Update commission record', 'PUT', `/api/commission-records/${resources.commissionId}`, {
      session: 'tenant', body: { status: 'pending_settlement' }, expectedStatuses: [200], requiredPath: 'data._id',
    });
  }

  const conversation = await check('Create AI conversation', 'POST', '/api/ai/conversations', {
    session: 'tenant', body: {}, expectedStatuses: [200, 201], requiredPath: 'data._id', fatal: false,
  });
  if (is2xx(conversation.status)) {
    resources.conversationId = idFrom(conversation, 'data._id', 'data.id');
  }
  await check('List AI conversations', 'GET', '/api/ai/conversations', { session: 'tenant', expectedStatuses: [200], requiredPath: 'data' });
  if (resources.conversationId) {
    await check('Read AI conversation', 'GET', `/api/ai/conversations/${resources.conversationId}`, { session: 'tenant', expectedStatuses: [200], requiredPath: 'data._id' });
  }

  const roles = await check('List system roles', 'GET', '/api/roles', { session: 'platform', expectedStatuses: [200], requiredPath: 'data' });
  const role = Array.isArray(roles.body?.data) ? roles.body.data[0] : null;
  if (role) {
    await check('No-op update system role permissions', 'PATCH', '/api/roles', {
      session: 'platform', body: { id: role._id, menuKeys: role.menuKeys }, expectedStatuses: [200], requiredPath: 'data._id',
    });
  }
  const promotionConfig = await check('Read promotion configuration', 'GET', '/api/platform/promotion-config', {
    session: 'platform', expectedStatuses: [200], requiredPath: 'data',
  });
  await check('No-op update promotion configuration', 'PATCH', '/api/platform/promotion-config', {
    session: 'platform', body: promotionConfig.body.data, expectedStatuses: [200], requiredPath: 'data',
  });

  const provider = await check('Create disabled AI provider configuration', 'POST', '/api/admin/ai-providers', {
    session: 'platform', body: {
      key: `${runKey}-provider`, name: `${runKey} Provider`, adapterType: 'grs', baseUrl: 'https://example.test/api', apiKey: 'test-only-not-a-real-key', enabled: false,
      adapterConfig: {}, capabilities: ['chat'], modelMappings: { 'chat.general': 'test-model' }, priority: 9999, timeoutMs: 5000,
    }, expectedStatuses: [201], requiredPath: 'data.id', fatal: false,
  });
  if (provider.status === 201) {
    resources.providerId = idFrom(provider, 'data.id', 'data._id');
    await check('Update disabled AI provider configuration', 'PATCH', `/api/admin/ai-providers/${resources.providerId}`, {
      session: 'platform', body: { name: `${runKey} Provider Updated`, enabled: false }, expectedStatuses: [200], requiredPath: 'data.id', fatal: false,
    });
    await check('Disable AI provider configuration', 'DELETE', `/api/admin/ai-providers/${resources.providerId}`, {
      session: 'platform', expectedStatuses: [200], requiredPath: 'data.id', fatal: false,
    });
  }

  const disposableDepartment = await check('Create department deletion target', 'POST', '/api/departments', {
    session: 'tenant', body: { name: `${runKey} Disposable Department`, order: 99 }, expectedStatuses: [201], requiredPath: 'data._id',
  });
  const disposableDepartmentId = idFrom(disposableDepartment, 'data._id', 'data.id');
  await check('Delete department', 'DELETE', `/api/departments/${disposableDepartmentId}`, {
    session: 'tenant', expectedStatuses: [200], requiredPath: 'success',
  });

  const disposableStaff = await check('Create staff deletion target', 'POST', '/api/staff', {
    session: 'tenant', body: {
      username: `${runKey}-delete-staff`, password: 'ApiTest123456!', displayName: 'API Test Disposable Staff', role: 'measurer',
      phone: `133${(Number(stamp) + 6).toString().padStart(8, '0').slice(-8)}`,
    }, expectedStatuses: [201], requiredPath: 'data._id',
  });
  const disposableStaffId = idFrom(disposableStaff, 'data._id', 'data.id');
  await check('Delete staff', 'DELETE', `/api/staff/${disposableStaffId}`, {
    session: 'tenant', expectedStatuses: [200], requiredPath: 'success',
  });

  await check('Delete inspiration', 'DELETE', `/api/inspirations?id=${resources.inspirationId}`, {
    session: 'tenant', expectedStatuses: [200], requiredPath: 'success',
  });
  await check('Delete floor plan', 'DELETE', `/api/floorplans/${resources.floorPlanId}`, {
    session: 'mini', expectedStatuses: [200], requiredPath: 'success',
  });
  await check('Delete lead', 'DELETE', `/api/leads/${resources.leadId}`, {
    session: 'tenant', expectedStatuses: [200], requiredPath: 'success',
  });
  await check('Delete device', 'DELETE', `/api/devices/${resources.deviceId}`, {
    session: 'tenant', expectedStatuses: [200], requiredPath: 'success',
  });
  await check('Delete platform admin user', 'DELETE', `/api/admin-users/${resources.adminUserId}`, {
    session: 'platform', expectedStatuses: [200], requiredPath: 'success',
  });
  await check('Delete package', 'DELETE', `/api/admin/packages/${resources.packageId}`, {
    session: 'platform', expectedStatuses: [200], requiredPath: 'success',
  });
  await check('Delete current Mini Program profile', 'DELETE', `/api/users/${encodeURIComponent(resources.openid)}`, {
    session: 'mini', expectedStatuses: [200], requiredPath: 'success',
  });

  await check('Set platform sensitive password', 'PUT', '/api/admin/sensitive-password', {
    session: 'platform',
    body: { password: 'ApiTest.1', confirmPassword: 'ApiTest.1' },
    expectedStatuses: [200],
    requiredPath: 'data.configured',
  });
  const disposablePhone = `132${(Number(stamp) + 7).toString().padStart(8, '0').slice(-8)}`;
  const disposableEnterprise = await check('Create enterprise deletion target', 'POST', '/api/admin/enterprises', {
    session: 'platform', body: {
      name: `${runKey} Disposable Enterprise`, code: `${runKey}-delete`, status: 'active',
      contactPerson: { name: 'Disposable Tenant Admin', phone: disposablePhone },
    }, expectedStatuses: [200, 201], requiredPath: 'data._id',
  });
  const disposableEnterpriseId = idFrom(disposableEnterprise, 'data._id', 'data.id');
  await check('Delete enterprise', 'DELETE', `/api/admin/enterprises/${disposableEnterpriseId}`, {
    session: 'platform',
    body: {
      confirmEnterpriseName: `${runKey} Disposable Enterprise`,
      securityPassword: 'ApiTest.1',
    },
    expectedStatuses: [200],
    requiredPath: 'success',
  });
  await check('Logout disposable platform session', 'POST', '/api/auth/logout', {
    session: 'platform', expectedStatuses: [200], requiredPath: 'success',
  });
}

async function runSmokeMatrix(discovered) {
  const alreadyCovered = new Set(results.map((item) => `${item.method} ${item.path.split('?')[0]}`));
  const excluded = new Map([
    ['POST /api/automation/reminders/run', 'Would process platform-wide reminder state outside the isolated tenant'],
    ['POST /api/admin/ai-reconciliation', 'Would reconcile platform-wide AI billing state'],
  ]);
  for (const route of discovered) {
    const resolvedPath = resolveDynamicPath(route.template);
    const key = `${route.method} ${route.template}`;
    const covered = [...alreadyCovered].some((item) => {
      const [method, path] = item.split(' ');
      if (method !== route.method) return false;
      const pattern = route.template
        .split('/')
        .map((segment) => segment.startsWith('[') && segment.endsWith(']')
          ? '[^/]+'
          : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('/');
      return new RegExp(`^${pattern}$`).test(path);
    });
    if (covered) continue;
    if (excluded.has(key)) {
      results.push({
        name: 'Smoke matrix safety exclusion', category: 'excluded', method: route.method, path: route.template,
        session: smokeSession(route.template), status: null, durationMs: 0, expectedStatuses: [], passed: null,
        requiredPath: null, responseSummary: excluded.get(key), file: route.file,
      });
      continue;
    }
    const response = await request(route.method, resolvedPath, {
      session: smokeSession(route.template),
      body: smokeBody(route.template, route.method),
      timeoutMs: 25_000,
    });
    const classification = classifySmoke(response);
    results.push({
      name: 'Discovered route smoke probe', category: 'smoke', method: route.method, path: resolvedPath,
      routeTemplate: route.template, session: smokeSession(route.template), status: response.status,
      durationMs: response.durationMs, expectedStatuses: [200, 201, 202, 204, 400, 401, 403, 404, 409, 410, 422],
      passed: classification.passed, requiredPath: null, responseSummary: response.error || response.body?.error || response.body?.message || classification.verdict,
      verdict: classification.verdict, file: route.file,
    });
  }
}

async function cleanupTestData() {
  const apiCleanup = [
    ['DELETE', resources.inspirationId ? `/api/inspirations?id=${resources.inspirationId}` : null, 'tenant'],
    ['DELETE', resources.conversationId ? `/api/ai/conversations/${resources.conversationId}` : null, 'tenant'],
    ['DELETE', resources.floorPlanId ? `/api/floorplans/${resources.floorPlanId}` : null, 'mini'],
    ['DELETE', resources.leadId ? `/api/leads/${resources.leadId}` : null, 'tenant'],
    ['DELETE', resources.deviceId ? `/api/devices/${resources.deviceId}` : null, 'tenant'],
    ['DELETE', resources.staffId ? `/api/staff/${resources.staffId}` : null, 'tenant'],
    ['DELETE', resources.departmentId ? `/api/departments/${resources.departmentId}` : null, 'tenant'],
    ['DELETE', resources.adminUserId ? `/api/admin-users/${resources.adminUserId}` : null, 'platform'],
    ['DELETE', resources.packageId ? `/api/admin/packages/${resources.packageId}` : null, 'platform'],
  ];
  for (const [method, path, session] of apiCleanup) {
    if (!path) continue;
    const response = await request(method, path, { session });
    cleanupResults.push({ method, path, status: response.status, success: is2xx(response.status) || response.status === 404, summary: response.body?.error || response.body?.message || 'success' });
  }

  // Remove records for which the public API intentionally has no delete operation.
  const enterpriseIds = [
    resources.enterpriseId,
    ...(process.env.API_TEST_EXTRA_CLEANUP_ENTERPRISE_IDS || '').split(',').map((item) => item.trim()),
  ].filter((item, index, values) => item && /^[1-9]\d*$/.test(item) && values.indexOf(item) === index);
  for (const id of enterpriseIds) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `select set_config('app.current_enterprise_id', '', true), set_config('app.is_platform_admin', 'true', true)`
      );
      const tables = await client.query(
        `select table_name
           from information_schema.columns
          where table_schema = 'app'
            and column_name = 'enterprise_id'
            and table_name <> 'enterprises'
          order by table_name desc`
      );
      for (let pass = 0; pass <= tables.rows.length; pass += 1) {
        let progress = false;
        for (const { table_name: tableName } of tables.rows) {
          await client.query('savepoint cleanup_table');
          try {
            const deleted = await client.query(
              `delete from app."${String(tableName).replaceAll('"', '""')}" where enterprise_id = $1`,
              [id]
            );
            await client.query('release savepoint cleanup_table');
            if (deleted.rowCount) progress = true;
          } catch {
            await client.query('rollback to savepoint cleanup_table');
            await client.query('release savepoint cleanup_table');
          }
        }
        if (!progress) break;
      }
      await client.query('delete from app.enterprises where id = $1', [id]);
      await client.query('commit');
      cleanupResults.push({ method: 'SQL', path: `isolated enterprise ${id}`, status: 200, success: true, summary: 'Residual isolated test data removed' });
    } catch (error) {
      await client.query('rollback');
      cleanupResults.push({ method: 'SQL', path: `isolated enterprise ${id}`, status: 500, success: false, summary: error instanceof Error ? error.message : String(error) });
    } finally {
      client.release();
    }
  }

  for (const action of cleanup.reverse()) {
    try {
      await action();
      cleanupResults.push({ method: 'SQL', path: 'temporary platform administrator', status: 200, success: true, summary: 'Removed' });
    } catch (error) {
      cleanupResults.push({ method: 'SQL', path: 'temporary platform administrator', status: 500, success: false, summary: error instanceof Error ? error.message : String(error) });
    }
  }
}

async function main() {
  const startedAt = new Date();
  const discovered = await discoverRoutes();
  let fatalError = null;
  try {
    const credentials = await setupPlatformAdmin();
    await runCoreScenarios(credentials);
    await runSmokeMatrix(discovered);
  } catch (error) {
    fatalError = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    await cleanupTestData();
    const payload = {
      runKey,
      baseUrl,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      discoveredRouteFiles: new Set(discovered.map((item) => item.file)).size,
      discoveredOperations: discovered.length,
      fatalError,
      resources,
      summary: {
        passed: results.filter((item) => item.passed === true).length,
        failed: results.filter((item) => item.passed === false).length,
        excluded: results.filter((item) => item.passed === null).length,
        serverErrors: results.filter((item) => item.status >= 500).length,
      },
      results,
      cleanupResults,
    };
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ outputPath, ...payload.summary, discoveredRouteFiles: payload.discoveredRouteFiles, discoveredOperations: payload.discoveredOperations, fatalError }, null, 2));
    await pool.end();
    if (fatalError) process.exitCode = 1;
  }
}

await main();
