'use client';
import { useEffect, useState } from 'react';

type VoiceRoom = { id: string; name: string; protected: boolean; password?: string; broadcasting: boolean };
export default function VoiceStreamSetup() {
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('Stream voice room');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [login, setLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sourceUrl: string; roomUrl: string }>();
  useEffect(() => { fetch('/api/voice/stream-source?list=1', { cache: 'no-store' }).then(async r => { if (r.status === 401) { setLogin(true); return; } const b = await r.json(); setRooms(b.rooms || []); }).catch(() => setError('Could not load rooms')); }, []);
  const select = async (action: string) => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/voice/stream-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, roomId, name: action === 'create' ? name : undefined, password }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || 'Could not connect voices');
      if (action === 'off') { setResult(undefined); setError('Voice broadcasting stopped for this room.'); return; }
      setResult(b);
      if (window.opener) window.opener.postMessage({ type: 'spmt.hmo.voice-source', sourceUrl: b.sourceUrl, roomUrl: b.roomUrl, roomName: b.name, roomId: b.roomId }, 'https://spmt.live');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect voices'); }
    finally { setBusy(false); }
  };
  return <main style={{ maxWidth: 520, margin: '40px auto', padding: 24 }}>
    <h1 style={{ fontSize: 26, marginBottom: 16 }}>HearMeOut Voices</h1>
    <p>Choose a room for this stream, or create a password-protected room. Unmuted people, AI voices and the room’s Discord bridge will be heard on stream. Stream audio is captured by its own hidden, receive-only listener URL; it is separate from the Discord bridge controls and does not create or toggle the Discord bot connection.</p>
    {login ? <a href="/api/auth/spmt/login?next=%2Fvoice-stream%2Fsetup">Sign in with SPMT</a> : <>
      <label style={{ display: 'block', marginTop: 20 }}>Room<select value={roomId} onChange={e => { setRoomId(e.target.value); setPassword(rooms.find(r => r.id === e.target.value)?.password || ''); }} style={{ display: 'block', width: '100%', padding: 10, color: '#111' }}><option value="">Create a new room</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}{r.broadcasting ? ' · on stream' : ''}</option>)}</select></label>
      {!roomId && <label style={{ display: 'block', marginTop: 12 }}>Name<input value={name} onChange={e => setName(e.target.value)} style={{ display: 'block', width: '100%', padding: 10, color: '#111' }} /></label>}
      <label style={{ display: 'block', marginTop: 12 }}>Room password{roomId && rooms.find(r => r.id === roomId)?.protected && ' (leave blank to keep it)'}<input type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} style={{ display: 'block', width: '100%', padding: 10, color: '#111' }} /></label>
      <label style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} /> Show room password</label>
      <button disabled={busy} onClick={() => void select(roomId ? 'select' : 'create')} style={{ marginTop: 20, padding: 12, border: '1px solid currentColor', borderRadius: 8 }}>{busy ? 'Connecting…' : 'Use room voices on stream'}</button>
      {roomId && <button disabled={busy} onClick={() => void select('off')} style={{ display: 'block', marginTop: 12 }}>Stop broadcasting this room</button>}
    </>}
    {error && <p role="status" style={{ marginTop: 16 }}>{error}</p>}
    {result && <div style={{ marginTop: 20 }}><p>Added to Overlay Bay. Save the overlay there.</p><a href={result.roomUrl} target="_blank" rel="noreferrer">Join the voice room</a><p style={{ marginTop: 12 }}>Hidden stream listener URL (OBS or browser source):</p><input readOnly value={result.sourceUrl} onFocus={e => e.target.select()} style={{ width: '100%', padding: 8, color: '#111' }} /></div>}
  </main>;
}
