'use client';

import React from 'react';
import type { RemoteParticipant } from 'livekit-client';
import { Mic, MicOff, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/use-session';
import { useCollection } from '@/hooks/use-db';
import { isPersonaParticipant, parsePersonaMetadata } from './PersonaCard';
import { resolveBotInvocation, type RoomBotDescriptor } from '@/lib/room-persona-routing';
import { postRoomChatMessage, sendRoomPersonaCommand, type RoomChatMessage } from '@/lib/room-persona-client';

const BUFFER_MS = 30_000;
const MAX_SEGMENTS = 12;

type SpeechSegment = { index: number; text: string; at: number; final: boolean };
type RoomBotPresence = { id?: string; uid?: string; bot?: boolean; presenceKind?: string; displayName?: string; personaId?: string; ownerTenantId?: string; wakeNames?: string[]; aliases?: string[]; previousNames?: string[] };

function wakePhraseIn(text: string, targets: RoomBotDescriptor[]) {
  const lower = text.toLowerCase();
  return targets.some((target) => target.wakeNames.some((name) => {
    const normalized = String(name || '').trim().toLowerCase();
    return normalized && lower.includes(normalized);
  }));
}

function removeWakePhrases(text: string, targets: RoomBotDescriptor[]) {
  return targets.reduce((value, target) => target.wakeNames.reduce((current, name) => {
    const normalized = String(name || '').trim();
    if (!normalized) return current;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return current.replace(new RegExp(`\\b${escaped}\\b[:,]?`, 'ig'), '').trim();
  }, value), text).trim();
}

function descriptors(participants: RemoteParticipant[]): RoomBotDescriptor[] {
  return participants.flatMap((participant) => {
    if (!isPersonaParticipant(participant)) return [];
    const metadata = parsePersonaMetadata(participant.metadata) || {};
    const identityName = participant.identity.replace(/^persona:/, '');
    const displayName = String(metadata.displayName || participant.name || identityName || 'StreamWeaver Bot').trim();
    const wakeNames = Array.from(new Set([
      displayName, metadata.personaId, participant.name, identityName,
      ...(metadata.wakeNames || []), ...(metadata.aliases || []), ...(metadata.previousNames || []),
    ].map((value) => String(value || '').trim()).filter(Boolean)));
    const targetTenantId = String(metadata.ownerTenantId || metadata.personaId || identityName || '').trim();
    return targetTenantId ? [{ displayName, wakeNames, targetTenantId }] : [];
  });
}

function roomMessage(username: string, text: string, prefix: string): RoomChatMessage {
  return { id: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, username, text, timestamp: new Date().toISOString() };
}

function recognitionConstructor(): any {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * Explicit test-only wake path. Speech recognition is opt-in and transcripts
 * stay in this component's bounded in-memory buffer until an active bot wake name is heard.
 * Browser speech recognition may transmit audio to the browser vendor's
 * recognition service; this component does not promise on-device audio STT.
 */
export default function StellaWakeTestListener({ roomId, remoteParticipants }: { roomId: string; remoteParticipants: RemoteParticipant[] }) {
  const { user } = useSession();
  const { data: roomUsers } = useCollection<RoomBotPresence>(`rooms/${roomId}/users`, { pollInterval: 3000 });
  const targets = React.useMemo(() => {
    const liveTargets = descriptors(remoteParticipants);
    const presenceTargets = (roomUsers || []).flatMap((presence) => {
      if (presence.bot !== true && presence.presenceKind !== 'persona') return [];
      const identityName = String(presence.personaId || presence.ownerTenantId || presence.id || presence.uid || '').replace(/^persona:/, '').trim();
      const displayName = String(presence.displayName || identityName || 'StreamWeaver Bot').trim();
      const targetTenantId = String(presence.ownerTenantId || presence.personaId || identityName).trim();
      const wakeNames = Array.from(new Set([displayName, targetTenantId, ...(presence.wakeNames || []), ...(presence.aliases || []), ...(presence.previousNames || [])].map((value) => String(value || '').trim()).filter(Boolean)));
      return targetTenantId ? [{ displayName, wakeNames, targetTenantId }] : [];
    });
    return Array.from(new Map([...liveTargets, ...presenceTargets].map((target) => [target.targetTenantId, target])).values());
  }, [remoteParticipants, roomUsers]);
  const targetsRef = React.useRef(targets);
  targetsRef.current = targets;
  const userRef = React.useRef(user);
  userRef.current = user;
  const roomRef = React.useRef(roomId);
  roomRef.current = roomId;
  const recognitionRef = React.useRef<any>(null);
  const enabledRef = React.useRef(false);
  const segmentsRef = React.useRef<SpeechSegment[]>([]);
  const handledIndicesRef = React.useRef(new Set<number>());
  const commandInFlightRef = React.useRef(false);
  const [enabled, setEnabled] = React.useState(false);
  const [status, setStatus] = React.useState('Off');
  const [error, setError] = React.useState('');
  const [lastTranscript, setLastTranscript] = React.useState('');
  const [reply, setReply] = React.useState('');

  React.useEffect(() => {
    if (enabled) setStatus(targets.length ? 'Listening' : 'Listening; waiting for room bot');
  }, [enabled, targets]);

  React.useEffect(() => () => {
    enabledRef.current = false;
    try { recognitionRef.current?.abort(); } catch {}
    recognitionRef.current = null;
    segmentsRef.current = [];
  }, []);

  const stop = React.useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    setStatus('Off');
    try { recognitionRef.current?.stop(); } catch {}
  }, []);

  const start = React.useCallback(() => {
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setError('This browser does not support Web Speech recognition. No audio was recorded or sent.');
      setStatus('Unavailable');
      return;
    }
    setError('');
    setReply('');
    setLastTranscript('');
    segmentsRef.current = [];
    handledIndicesRef.current.clear();
    enabledRef.current = true;
    setEnabled(true);
    setStatus('Starting…');

    const recognition = new Constructor();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => { if (enabledRef.current) setStatus(targetsRef.current.length ? 'Listening' : 'Listening; waiting for room bot'); };
    recognition.onresult = (event: any) => {
      if (!enabledRef.current) return;
      const now = Date.now();
      for (let index = Number(event.resultIndex || 0); index < (event.results?.length || 0); index++) {
        const result = event.results[index];
        const text = String(result?.[0]?.transcript || '').trim();
        if (!text) continue;
        const final = Boolean(result.isFinal);
        const old = segmentsRef.current.find((segment) => segment.index === index);
        const segment: SpeechSegment = { index, text, at: old?.text === text ? old.at : now, final };
        segmentsRef.current = [...segmentsRef.current.filter((item) => item.index !== index), segment]
          .filter((item) => now - item.at <= BUFFER_MS)
          .sort((a, b) => a.index - b.index)
          .slice(-MAX_SEGMENTS);
        setLastTranscript(text);
        // Mirror recognized browser speech into the local avatar's speaking ring.
        // This confirms recognition is receiving words; it does not claim P2P audio is published.
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('hmo-local-wake-speech-detected', { detail: { text, at: now } }));

        if (!final || !wakePhraseIn(text, targetsRef.current) || handledIndicesRef.current.has(index)) continue;
        handledIndicesRef.current.add(index);
        const contextSegments = segmentsRef.current
          .filter((item) => now - item.at <= BUFFER_MS)
          .map((item) => item.text);
        const latestRequest = removeWakePhrases(text, targetsRef.current) || text;
        const context = [
          'Recent speech context (captured in memory during the last 30 seconds):',
          ...contextSegments,
          `Latest request: ${latestRequest}`,
        ].join('\n');
        const invocation = resolveBotInvocation(text, targetsRef.current);
        const target = invocation?.targetTenantId
          ? invocation
          : targetsRef.current[0];
        if (!target?.targetTenantId || commandInFlightRef.current) continue;

        // Nothing is sent before this active bot's configured wake name matches.
        segmentsRef.current = [];
        commandInFlightRef.current = true;
        setStatus(`Sending to ${target.displayName}…`);
        void (async () => {
          const currentUser = userRef.current;
          const actorName = String(currentUser?.displayName || (currentUser as any)?.username || 'HearMeOut User').trim();
          const actorIdentity = String(currentUser?.uid || '').trim();
          const actorUsername = String((currentUser as any)?.username || currentUser?.displayName || '').trim();
          setLastTranscript(context);
          try {
            await postRoomChatMessage(roomMessage(actorName, context, 'stella_wake_context')).catch((cause) => console.warn('[StellaWakeTest] Context mirror failed:', cause));
            const result = await sendRoomPersonaCommand({
              roomId: roomRef.current,
              transcript: context,
              targetTenantId: target.targetTenantId!,
              fallbackDisplayName: target.displayName,
              actorIdentity,
              actorUsername,
              actorDisplayName: actorName,
            });
            setReply(result.reply || `${result.botName} received the command.`);
            setStatus(result.speechError ? 'Reply received; voice failed' : 'Wake successful');
            if (result.reply) await postRoomChatMessage(roomMessage(result.botName, result.reply, 'stella_wake_reply'));
            if (result.speechError) setError(`Text reply succeeded, but voice playback failed: ${result.speechError}`);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setStatus('Command failed');
          } finally {
            commandInFlightRef.current = false;
          }
        })();
      }
    };
    recognition.onerror = (event: any) => {
      if (!enabledRef.current) return;
      const message = String(event?.error || 'speech recognition error');
      if (message === 'no-speech' || message === 'aborted') return;
      enabledRef.current = false;
      setEnabled(false);
      setError(`Browser speech recognition error: ${message}. No cloud fallback is added by HearMeOut.`);
      setStatus('Recognition error');
    };
    recognition.onend = () => {
      if (!enabledRef.current || recognitionRef.current !== recognition) return;
      // Some browsers end a continuous session after silence; restart while the
      // explicit test toggle remains enabled.
      try { recognition.start(); setStatus(targetsRef.current.length ? 'Listening' : 'Listening; waiting for room bot'); }
      catch { setStatus('Restarting…'); }
    };

    try { recognition.start(); }
    catch (cause) {
      enabledRef.current = false;
      setEnabled(false);
      setStatus('Off');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  return (
    <section className="col-span-full rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={enabled ? 'destructive' : 'secondary'} onClick={enabled ? stop : start}>
          {enabled ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
          {enabled ? 'Stop wake-word test' : 'Enable wake-word test'}
        </Button>
        <span className="text-sm font-medium">Wake-word test: {status}</span>
        {commandInFlightRef.current && <LoaderCircle className="h-4 w-4 animate-spin" />}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Test mode only. Keeps up to 30 seconds of transcript in memory and sends it to the first active room bot (or a named bot in your request) only after hearing the active bot’s display name or configured alias. Browser speech recognition may send microphone audio to the browser vendor for recognition; pre-wake transcript text is not sent by HearMeOut.
      </p>
      {lastTranscript && <p className="mt-2 whitespace-pre-wrap break-words text-sm"><strong>Latest capture:</strong> {lastTranscript}</p>}
      {reply && <p className="mt-2 whitespace-pre-wrap break-words text-sm"><strong>Bot reply:</strong> {reply}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}
