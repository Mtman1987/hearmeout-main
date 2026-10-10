const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const Module = require('node:module');
const { patchSource } = require('../scripts/patch-youtube-search.cjs');
const file = require.resolve('youtube-sr');
const source = fs.readFileSync(file, 'utf8');
const patched = new Module(file, module);
patched.filename = file;
patched.paths = Module._nodeModulePaths(require('node:path').dirname(file));
patched._compile(patchSource(source), file);
const formatter = patched.exports.Util;
function fixture(ownerText) {
  return { videoRenderer: {
    videoId: 'O431N-XdZpQ', title: { runs: [{ text: 'Inpatient - Smoking Gun' }] },
    thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/O431N-XdZpQ/default.jpg', width: 120, height: 90 }] },
    ownerText, lengthText: { simpleText: '4:00' },
  }};
}
test('search retains music result with channel name but no browse endpoint', () => {
  const result = formatter.parseVideo(fixture({ runs: [{ text: 'Ren', navigationEndpoint: { watchEndpoint: { videoId: 'O431N-XdZpQ' } } }] }));
  assert.equal(result.id, 'O431N-XdZpQ');
  assert.equal(result.title, 'Inpatient - Smoking Gun');
  assert.equal(result.channel.name, 'Ren');
});
test('missing owner metadata does not discard the search result', () => {
  assert.equal(formatter.parseVideo(fixture(undefined)).id, 'O431N-XdZpQ');
  assert.equal(formatter.parseVideo(fixture({ runs: [] })).id, 'O431N-XdZpQ');
});
test('normal channel identity and URL are preserved', () => {
  const result = formatter.parseVideo(fixture({ runs: [{ text: 'Ren', navigationEndpoint: { browseEndpoint: { browseId: 'UC-ren', canonicalBaseUrl: '/@RenMakesMusic' } } }] }));
  assert.equal(result.channel.id, 'UC-ren');
  assert.equal(result.channel.url, 'https://www.youtube.com/@RenMakesMusic');
});
test('patch is repeatable and fails closed when dependency structure changes', () => {
  assert.equal(patchSource(patchSource(source)), patchSource(source));
  assert.throws(() => patchSource('unrecognized parser'), /parser changed/);
});
