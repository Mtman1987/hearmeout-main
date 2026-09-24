import {
  controlWatchSession,
  getPublicWatchSession,
  requestWatchMusicItem,
} from '../src/lib/watch-request-service';

const [mode, sessionId, encodedValue = ''] = process.argv.slice(2);
if (!mode || !sessionId) {
  console.error('Usage: smoke-lounge-action <request|control> <sessionId> <base64url-value>');
  process.exit(2);
}

const value = encodedValue ? Buffer.from(encodedValue, 'base64url').toString('utf8') : '';

if (mode === 'request') {
  const result = await requestWatchMusicItem({
    sessionId,
    query: value,
    userId: 'production-smoke',
    username: 'Production Smoke',
    platform: 'admin',
  });
  if ('error' in result) {
    console.error(result.result?.message || result.error);
    process.exit(1);
  }
  console.log('SMOKE_RESULT ' + Buffer.from(JSON.stringify({
    request: result.request,
    session: getPublicWatchSession(result.session),
  })).toString('base64url'));
  process.exit(0);
}

if (mode === 'control') {
  const session = await controlWatchSession(
    sessionId,
    value,
    undefined,
    undefined,
    { actorUserId: 'production-smoke', isAdmin: true, platform: 'admin' },
  );
  console.log('SMOKE_RESULT ' + Buffer.from(JSON.stringify({
    session: getPublicWatchSession(session),
  })).toString('base64url'));
  process.exit(0);
}

console.error('Unsupported smoke action mode');
process.exit(2);
