"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, CircleAlert, CircleDashed, Volume2, X } from "lucide-react";

 type ProbeState = {
  botName: string;
  responseText: string;
  audioDataUri: string;
  ttsGenerated: boolean;
  directPlayback: "idle" | "playing" | "failed" | "ended";
  directPlaybackError?: string;
  handoffAttempted: boolean;
  handoffOk: boolean;
  handoffStatus?: number;
  handoffError?: string;
  workerBytes?: number;
  transportHealthy?: boolean;
  roomAudioElements: number;
};

function Stage({ ok, pending, label, detail }: { ok?: boolean; pending?: boolean; label: string; detail: string }) {
  const Icon = pending ? CircleDashed : ok ? CheckCircle2 : CircleAlert;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/70 bg-background/80 px-2.5 py-2 text-xs">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${pending ? "text-muted-foreground" : ok ? "text-green-500" : "text-destructive"}`} />
      <div className="min-w-0">
        <div className="font-semibold">{label}</div>
        <div className="break-words text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function extractPayload(payload: any): ProbeState {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const tts = data?.tts || payload?.tts || {};
  const speech = payload?.personaSpeech || data?.personaSpeech || {};
  const worker = speech?.worker || {};
  const audioDataUri = String(tts?.audioDataUri || "");
  const bytes = Number(worker?.bytes);
  return {
    botName: String(data?.bot?.name || payload?.bot?.name || "Persona"),
    responseText: String(data?.response || payload?.response || ""),
    audioDataUri,
    ttsGenerated: audioDataUri.startsWith("data:audio/"),
    directPlayback: "idle",
    handoffAttempted: speech?.attempted === true,
    handoffOk: speech?.ok === true,
    handoffStatus: Number.isFinite(Number(speech?.status)) ? Number(speech.status) : undefined,
    handoffError: String(speech?.error || "") || undefined,
    workerBytes: Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined,
    transportHealthy: typeof worker?.transportHealthy === "boolean" ? worker.transportHealthy : undefined,
    roomAudioElements: document.querySelectorAll("[data-room-audio-renderer] audio").length,
  };
}

export function TtsDiagnosticHost() {
  const pathname = usePathname();
  const [probe, setProbe] = useState<ProbeState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const active = /^\/rooms\/[^/]+/.test(pathname || "");

  const refreshRoomAudioElements = useCallback(() => {
    setProbe((current) => current ? {
      ...current,
      roomAudioElements: document.querySelectorAll("[data-room-audio-renderer] audio").length,
    } : current);
  }, []);

  useEffect(() => {
    if (!active) return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      try {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        if (url.includes("/api/bot/commands") && (init?.method || "GET").toUpperCase() === "POST") {
          const payload = await response.clone().json().catch(() => null);
          if (payload) {
            setDismissed(false);
            setProbe(extractPayload(payload));
            setTimeout(refreshRoomAudioElements, 250);
            setTimeout(refreshRoomAudioElements, 1000);
            setTimeout(refreshRoomAudioElements, 2500);
          }
        }
      } catch (error) {
        console.warn("[TTS Diagnostic] Could not inspect bot response", error);
      }
      return response;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [active, refreshRoomAudioElements]);

  useEffect(() => {
    if (!probe?.audioDataUri) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    const promise = audio.play();
    if (promise && typeof promise.catch === "function") {
      promise
        .then(() => setProbe((current) => current ? { ...current, directPlayback: "playing", directPlaybackError: undefined } : current))
        .catch((error) => setProbe((current) => current ? {
          ...current,
          directPlayback: "failed",
          directPlaybackError: error instanceof Error ? error.message : String(error),
        } : current));
    }
  }, [probe?.audioDataUri]);

  if (!active || !probe || dismissed) return null;

  const directOk = probe.directPlayback === "playing" || probe.directPlayback === "ended";
  const directDetail = probe.directPlayback === "playing"
    ? "You are hearing the exact generated TTS directly from the browser player now."
    : probe.directPlayback === "ended"
      ? "Direct playback completed successfully."
      : probe.directPlayback === "failed"
        ? `Direct playback failed: ${probe.directPlaybackError || "unknown browser audio error"}`
        : "Waiting for direct browser playback.";

  return (
    <aside className="fixed bottom-3 right-3 z-[180] w-[min(430px,calc(100vw-24px))] max-h-[78vh] overflow-auto rounded-xl border border-primary/45 bg-background/95 p-3 shadow-2xl backdrop-blur" data-hmo-tts-diagnostic-host>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Volume2 className="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-bold">TTS → LiveKit diagnostic</div>
            <div className="text-[11px] text-muted-foreground">{probe.botName} · latest typed response</div>
          </div>
        </div>
        <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setDismissed(true)} aria-label="Close TTS diagnostic">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-2 rounded-md border border-border/70 bg-background/80 px-2.5 py-2 text-xs">
        <div className="font-semibold">Returned response</div>
        <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{probe.responseText || "No response text returned."}</div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Stage
          ok={probe.ttsGenerated}
          label="1 · TTS generated"
          detail={probe.ttsGenerated
            ? `${Math.max(1, Math.round(probe.audioDataUri.length / 1024))} KB audio data URI reached HearMeOut.`
            : "No audioDataUri came back from StreamWeaver."}
        />
        <Stage
          ok={directOk}
          pending={probe.directPlayback === "idle"}
          label="2 · Direct browser TTS"
          detail={directDetail}
        />
        <Stage
          ok={probe.handoffAttempted && probe.handoffOk}
          pending={!probe.handoffAttempted}
          label="3 · /persona/speak"
          detail={probe.handoffAttempted
            ? probe.handoffOk
              ? `Worker accepted the TTS${probe.workerBytes === undefined ? "" : ` and decoded ${probe.workerBytes.toLocaleString()} PCM bytes`}.`
              : `Handoff failed${probe.handoffStatus ? ` (${probe.handoffStatus})` : ""}: ${probe.handoffError || "unknown error"}`
            : "HearMeOut never attempted the persona speech handoff."}
        />
        <Stage
          ok={probe.transportHealthy === true}
          pending={probe.transportHealthy === undefined}
          label="4 · Worker LiveKit transport"
          detail={probe.transportHealthy === true
            ? "Worker says the persona LiveKit transport and publish source are healthy."
            : probe.transportHealthy === false
              ? "Worker says the persona LiveKit transport is unhealthy."
              : "No transport health result returned."}
        />
        <Stage
          ok={probe.roomAudioElements > 0}
          label="5 · Room audio renderer"
          detail={probe.roomAudioElements > 0
            ? `This browser currently has ${probe.roomAudioElements} LiveKit remote audio element${probe.roomAudioElements === 1 ? "" : "s"} mounted.`
            : "RoomAudioRenderer has no remote audio elements mounted in this browser."}
        />
      </div>

      {probe.audioDataUri ? (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Exact generated TTS — direct path</div>
          <audio
            ref={audioRef}
            src={probe.audioDataUri}
            controls
            className="h-10 w-full"
            onPlay={() => setProbe((current) => current ? { ...current, directPlayback: "playing", directPlaybackError: undefined } : current)}
            onEnded={() => setProbe((current) => current ? { ...current, directPlayback: "ended" } : current)}
            onError={() => setProbe((current) => current ? {
              ...current,
              directPlayback: "failed",
              directPlaybackError: "The browser audio element could not decode or play this generated TTS payload.",
            } : current)}
          />
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            This player and Athena's LiveKit track receive the same TTS payload. If this plays but stage 3 or 4 fails, the loss is before/during LiveKit handoff. If stages 1–4 pass but you only hear this player, the remaining fault is LiveKit subscription/playback in the room.
          </p>
        </div>
      ) : null}
    </aside>
  );
}
