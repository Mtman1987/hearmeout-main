const { join } = require('path');
const { existsSync, mkdirSync, writeFileSync, renameSync, statSync } = require('fs');
const { randomUUID } = require('crypto');

function createBrowserMediaCache(directory, legacyAudio) {
  function path(id, track) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(id) || !['audio', 'video'].includes(track)) throw Error('Invalid browser media');
    return join(directory, `browser-${id}-${track}.media`);
  }
  function file(id, track) {
    const value = path(id, track);
    return existsSync(value) && statSync(value).size ? value : track === 'audio' ? legacyAudio(id) : null;
  }
  return {
    file,
    status(id) { return { audio: Boolean(file(id, 'audio')), video: Boolean(file(id, 'video')) }; },
    write(id, track, body) {
      const target = path(id, track);
      if (!Buffer.isBuffer(body) || !body.length || body.length > 200 * 1024 * 1024) throw Error('Invalid media upload size');
      mkdirSync(directory, { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      writeFileSync(temporary, body, { mode: 0o600 });
      renameSync(temporary, target);
      return body.length;
    },
  };
}
module.exports = { createBrowserMediaCache };
