import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
process.env.HEARMEOUT_CLIENT_SECRET = 'test-client';
test('refresh restores linked identity and forwards replacement credentials on the current request', async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (input) => String(input).endsWith('/api/oauth/userinfo')
    ? new Response('{}', { status: 401 })
    : new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 604800, refresh_expires_in: 2592000,
      user: { id: 'canonical-user', username: 'spmt-user', twitchId: '12345', twitchUsername: 'linked_twitch', discordId: '987654321000', discordUsername: 'linked_discord' } }));
  for (const path of ['/api/spmt/workspace-theme', '/api/admin/test']) {
    const req = new NextRequest('https://app.fly.dev' + path, { headers: { cookie: 'hmo_spmt_session=old; hmo_spmt_refresh=saved' } });
    const res = await middleware(req);
    assert.equal(res.status, path.startsWith('/api/admin') ? 403 : 200);
    assert.match(res.headers.get('set-cookie') || '', /hmo_spmt_session=new-access/);
    assert.match(res.headers.get('set-cookie') || '', /hmo_spmt_refresh=new-refresh/);
    assert.match(res.headers.get('set-cookie') || '', /SameSite=none/i);
    if (res.status === 200) {
      assert.match(res.headers.get('x-middleware-request-cookie') || '', /hmo_spmt_session=new-access/);
      assert.match(res.headers.get('x-middleware-request-cookie') || '', /hmo_spmt_refresh=new-refresh/);
    }
  }
});
test('renewed local HearMeOut cookie uses the existing signer and canonical user key', async () => {
  const { createRefreshedHmoLocalSession } = await import('../src/lib/spmt-session');
  const { createHmac } = await import('node:crypto');
  const token = await createRefreshedHmoLocalSession('canonical-user');
  assert.ok(token);
  const [header, body, signature] = token.split('.');
  const secret = process.env.HEARMEOUT_JWT_SECRET || process.env.JWT_SECRET || 'hearmeout-local-development-only';
  assert.equal(signature, createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url'));
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  assert.equal(payload.uid, 'spmt_canonical-user');
  assert.ok(payload.exp > Date.now() / 1000 + 2591900);
});
