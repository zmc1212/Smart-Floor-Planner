import assert from 'node:assert/strict';
import { test } from 'node:test';
import { constructionRouteAllowed } from '../route-access';

test('Mini Program construction staff can read the shared public enterprise branding route', () => {
  assert.equal(constructionRouteAllowed('/api/branding/2402', true), true);
  for (const route of ['/api/branding', '/api/branding/0', '/api/branding/2402/edit', '/api/branding/2402/profile']) {
    assert.equal(constructionRouteAllowed(route, true), false, route);
  }
});

test('branding access preserves the construction lead, finance, survey and Admin route boundaries', () => {
  for (const miniProgram of [true, false]) {
    for (const route of ['/api/leads', '/api/floorplans', '/api/miniprogram/commissions', '/api/admin/enterprises/2402']) {
      assert.equal(constructionRouteAllowed(route, miniProgram), false, route);
    }
  }
  assert.equal(constructionRouteAllowed('/api/branding/2402', false), false);
  assert.equal(constructionRouteAllowed('/api/miniprogram/construction/projects', true), true);
  assert.equal(constructionRouteAllowed('/api/construction/projects', false), true);
});
