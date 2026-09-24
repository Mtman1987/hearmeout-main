import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('Live HMO is the only production HearMeOut authority', () => {
  const fly = read('fly.toml');
  const twitch = read('src/app/api/twitch-bot/route.ts');
  const middleware = read('src/middleware.ts');
  const rules = read('docs/LIVE_HMO_PRODUCTION_AUTHORITY.md');

  assert.doesNotMatch(fly, /APOLLO_LOUNGE|web-terminal-bvesa\.sprites\.app/);
  assert.doesNotMatch(twitch, /APOLLO_LOUNGE|web-terminal-bvesa\.sprites\.app|relayApolloLoungeCommand|lounge-twitch-request/);
  assert.doesNotMatch(middleware, /\/api\/internal\/lounge\/media/);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'src/app/api/internal/lounge/media/route.ts')), false);
  assert.match(twitch, /SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID/);
  assert.match(twitch, /SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID/);
  assert.match(rules, /only production HearMeOut authority/);
  assert.match(rules, /queues must never be merged/);
  assert.match(rules, /running both as competing authorities is forbidden/);
});
