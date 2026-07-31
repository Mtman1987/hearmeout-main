import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHearMeOutDiscordPayload } from '../src/lib/discord-messaging';

test('builds a branded embed and preserves controls without plain message content', async () => {
  const payload = await buildHearMeOutDiscordPayload({
    content: 'The watch party is ready.',
    components: [{ type: 1, components: [{ type: 2, label: 'Join', style: 5, url: 'https://example.com' }] }],
    flags: 64,
  }, {
    responseType: 'Watch Controls',
    sourceUser: 'Alice',
    sourceMessage: '!watch controls',
    sourceUserAvatarUrl: 'https://cdn.example.com/alice.png',
  });

  assert.equal(payload.content, '');
  assert.equal(payload.embeds?.[0]?.author?.name, 'HearMeOut');
  assert.equal(payload.embeds?.[0]?.title, 'HearMeOut • Watch Controls');
  assert.equal(payload.embeds?.[0]?.description, 'The watch party is ready.');
  assert.equal(payload.embeds?.[0]?.footer?.text, 'Requested by Alice • !watch controls');
  assert.equal(payload.embeds?.[0]?.footer?.icon_url, 'https://cdn.example.com/alice.png');
  assert.equal(payload.components?.[0]?.components?.[0]?.label, 'Join');
  assert.equal(payload.flags, 64);
});

test('moves an existing media thumbnail to the large image area', async () => {
  const payload = await buildHearMeOutDiscordPayload({
    embeds: [{
      title: 'A video title',
      description: 'Now playing',
      thumbnail: { url: 'https://cdn.example.com/poster.jpg' },
    }],
  }, {
    responseType: 'Watch Request',
    sourceUser: 'Bob',
    sourceMessage: '!wr example',
  });

  const embed = payload.embeds?.[0];
  assert.equal(embed?.title, 'HearMeOut • Watch Request');
  assert.equal(embed?.image?.url, 'https://cdn.example.com/poster.jpg');
  assert.match(embed?.thumbnail?.url || '', /hearmeout-icon-512\.png$/);
  assert.deepEqual(embed?.fields?.[0], {
    name: 'Media',
    value: 'A video title',
    inline: false,
  });
});
