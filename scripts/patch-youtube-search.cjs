const fs = require('node:fs');
const replacements = [
  ['data.videoRenderer.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId', 'data.videoRenderer.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId'],
  ['data.videoRenderer.ownerText.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl', 'data.videoRenderer.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl'],
  ['data.videoRenderer.ownerText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url', 'data.videoRenderer.ownerText?.runs?.[0]?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url'],
  ['data.videoRenderer.ownerText.runs[0].text', 'data.videoRenderer.ownerText?.runs?.[0]?.text'],
];
function patchSource(source) {
  for (const [before, after] of replacements) {
    if (source.includes(before)) source = source.split(before).join(after);
    else if (!source.includes(after)) throw new Error('youtube-sr search parser changed; review compatibility patch');
  }
  return source;
}
module.exports = { patchSource };
if (require.main === module) {
  const file = require.resolve('youtube-sr');
  const before = fs.readFileSync(file, 'utf8');
  const after = patchSource(before);
  if (after !== before) fs.writeFileSync(file, after);
  console.log('youtube-sr search channel compatibility patch verified');
}
