'use strict';

// Metadata only: all speakers keep sharing the existing single audio track.
class DiscordSpeakerPresence {
  constructor({ resolveMember, publish, now = Date.now, delayMs = 150 }) {
    this.resolveMember = resolveMember; this.publish = publish; this.now = now;
    this.delayMs = delayMs; this.members = new Map(); this.active = new Map();
    this.timer = null; this.closed = false; this.pending = false; this.dirty = false;
  }
  join(userId) {
    if (this.closed || this.members.has(userId)) return;
    const record = { userId, displayName: `Discord ${String(userId).slice(-4)}`, username: '', photoURL: '' };
    this.members.set(userId, record); this.changed();
    Promise.resolve().then(() => this.resolveMember(userId)).then(member => {
      if (this.closed || this.members.get(userId) !== record) return;
      Object.assign(record, { displayName: String(member.displayName || record.displayName).slice(0, 64), username: String(member.username || member.displayName || record.displayName).slice(0, 32), photoURL: String(member.photoURL || '').slice(0, 1024) }); this.changed();
    }).catch(() => {});
  }
  leave(userId) { this.members.delete(userId); this.active.delete(userId); this.changed(); }
  speaking(userId, active) { if (this.closed) return; this.join(userId); this.active.delete(userId); if (active) this.active.set(userId, this.now()); this.changed(); }
  snapshot() {
    const activeSpeakers = [...this.active.keys()].filter(id => this.members.has(id));
    const speaker = this.members.get(activeSpeakers.at(-1));
    return { source: 'discord', displayName: speaker?.displayName || 'Discord VC', photoURL: speaker?.photoURL || 'https://cdn.discordapp.com/embed/avatars/0.png',
      // Only the active speaker needs an avatar URL. Names fit normal voice
      // channels without repeating large avatar URLs in every metadata update.
      discordMembers: [...this.members.values()].map(({ userId, displayName, username }) => ({ userId, displayName, username })).slice(0, 100), activeSpeakers: activeSpeakers.slice(0, 100), memberCount: this.members.size };
  }
  changed() { if (this.closed) return; this.dirty = true; if (!this.timer) { this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.delayMs); this.timer.unref?.(); } }
  async flush() {
    if (this.closed || this.pending) return; this.pending = true; this.dirty = false;
    try { await this.publish(this.snapshot()); } catch { this.dirty = true; this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 1000); this.timer.unref?.(); }
    finally { this.pending = false; if (this.dirty && !this.closed) this.changed(); }
  }
  close() { this.closed = true; clearTimeout(this.timer); this.members.clear(); this.active.clear(); }
}
module.exports = { DiscordSpeakerPresence };
