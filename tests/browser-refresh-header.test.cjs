const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { NextRequest, NextResponse } = require('next/server');
const source = process.env.TEST_BASELINE ? execFileSync('git', ['show', 'HEAD:src/middleware.ts'], { encoding: 'utf8' }) : fs.readFileSync('src/middleware.ts', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load() {
  let refreshes = 0;
  const module = { exports: {} };
  const mocks = {
    'next/server': { NextRequest, NextResponse },
    '@/lib/activity-access': { isActivityEntry: () => false, isPublicActivityRequest: () => false },
    '@/lib/spmt-session': {
      HMO_SPMT_REFRESH_COOKIE: 'hmo_spmt_refresh',
      createRefreshedHmoLocalSession: async id => 'test-local-' + id,
      refreshHmoSpmtSession: async () => { refreshes++; return { user: { id: 'owner-id', role: 'owner' }, accessToken: 'fresh-access', refreshToken: 'fresh-refresh', expiresIn: 3600, refreshExpiresIn: 86400 }; },
    },
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: id => { if (!(id in mocks)) throw new Error(id); return mocks[id]; }, process, AbortSignal, Headers, URL, fetch: async () => new Response('', { status: 401 }) });
  return { middleware: module.exports.middleware, refreshes: () => refreshes };
}
test('expired browser cookie still renews when a stale bearer header accompanies it', async () => {
  const api = load();
  const response = await api.middleware(new NextRequest('https://hmo.test/api/admin/settings', { headers: { cookie: 'hmo_spmt_session=expired; hmo_spmt_refresh=refresh', authorization: 'Bearer stale-header' } }));
  assert.equal(response.headers.get('x-middleware-next'), '1');
  assert.equal(api.refreshes(), 1);
  assert.equal(response.cookies.get('hmo_spmt_session').value, 'fresh-access');
  assert.equal(response.cookies.get('hmo_session').value, 'test-local-owner-id');
  assert.equal(response.headers.get('x-middleware-request-x-spmt-user-id'), 'owner-id');
});
test('invalid bearer-only callers do not become browser users through refresh', async () => {
  const api = load();
  const response = await api.middleware(new NextRequest('https://hmo.test/api/admin/settings', { headers: { authorization: 'Bearer invalid' } }));
  assert.equal(response.status, 401);
  assert.equal(api.refreshes(), 0);
});
