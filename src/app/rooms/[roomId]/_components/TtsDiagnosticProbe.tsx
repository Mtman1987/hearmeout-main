"use client";

import React, { useEffect, useRef } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, Volume2 } from "lucide-react";

export type TtsDiagnosticState = {
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
  liveKitParticipantPresent: boolean;
  liveKitAudioTrackPresent: boolean;
};

function Stage({ ok, pending, label, detail }: { ok?: boolean; pending?: boolean; label: string; detail?: string }) {
  const Icon = pending ? CircleDashed : ok ? CheckCircle2 : CircleAlert;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-background/45 px-2.5 py-2 text-xs">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${pending ? "text-muted-foreground" : ok ? "text-green-500" : "text-destructive"}`} />
      <div className="min-w-0">
        <div className="font-semibold">{label}</div>
        {detail ? <div className="break-words text-muted-foreground">{detail}</div> : null}
      </div>
    </div>
  );
}

export default function TtsDiagnosticProbe({
  state,
  onPlaybackState,
}: {
  state: TtsDiagnosticState;
  onPlaybackState: (state: Pick<TtsDiagnosticState, "directPlayback" | "directPlaybackError">) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !state.audioDataUri) return;
    audio.currentTime = 0;
    const attempt = audio.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt
        .then(() => onPlaybackState({ directPlayback: "playing" }))
        .catch((error) => onPlaybackState({
          directPlayback: "failed",
          directPlaybackError: error instanceof Error ? error.message : String(error),
        }));
    }
  }, [state.audioDataUri, onPlaybackState]);

  const directDetail = state.directPlayback === "playing"
    ? "The generated TTS is playing directly in this browser now."
    : state.directPlayback === "ended"
      ? "Direct browser playback completed."
      : state.directPlayback === "failed"
        ? `Browser playback failed: ${state.directPlaybackError || "unknown error"}`
        : "Direct browser playback has not started yet.";

  return (
    <section className="rounded-lg border border-primary/35 bg-primary/5 p-3" data-hmo-tts-diagnostic>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-primary" />
          <div>
            <div className="text-xs font-bold uppercase tracking-wide">TTS → LiveKit diagnostic</div>
            <div className="text-[11px] text-muted-foreground">{state.botName || "Persona"} · exact response pipeline</div>
          </div>
        </div>
      </div>

      <div className="mb-2 rounded-md border border-border/60 bg-background/45 px-2.5 py-2 text-xs">
        <div className="font-semibold">Response text</div>
        <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{state.responseText || "No response text returned."}</div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Stage
          ok={state.ttsGenerated}
          label="1 · TTS generated"
          detail={state.ttsGenerated ? `${Math.max(0, Math.round(state.audioDataUri.length / 1024))} KB data URI returned by StreamWeaver.` : "No TTS audio payload returned."}
        />
        <Stage
          ok={state.directPlayback === "playing" || state.directPlayback === "ended"}
          pending={state.directPlayback === "idle"}
          label="2 · Direct browser audio"
          detail={directDetail}
        />
        <Stage
          ok={state.handoffAttempted && state.handoffOk}
          pending={!state.handoffAttempted}
          label="3 · Persona /speak handoff"
          detail={state.handoffAttempted
            ? state.handoffOk
              ? `Worker accepted the audio${state.workerBytes === undefined ? "" : ` and decoded ${state.workerBytes.toLocaleString()} PCM bytes`}.`
              : `Worker rejected the handoff${state.handoffStatus ? ` (${state.handoffStatus})` : ""}: ${state.handoffError || "unknown error"}`
            : "The server did not attempt a LiveKit persona speech handoff."}
        />
        <Stage
          ok={state.transportHealthy === true}
          pending={state.transportHealthy === undefined}
          label="4 · Worker LiveKit transport"
          detail={state.transportHealthy === true
            ? "Worker reports Athena's LiveKit transport is healthy."
            : state.transportHealthy === false
              ? "Worker reports the persona LiveKit transport is not healthy."
              : "No transport-health result returned."}
        />
        <Stage
          ok={state.liveKitParticipantPresent}
          label="5 · Persona visible in room"
          detail={state.liveKitParticipantPresent ? "The browser sees the persona as a remote LiveKit participant." : "The browser does not see the persona participant in this LiveKit room."}
        />
        <Stage
          ok={state.liveKitAudioTrackPresent}
          label="6 · Persona audio track visible"
          detail={state.liveKitAudioTrackPresent ? "The browser sees a published audio track for the persona." : "The persona is present, but no subscribed/published audio track is visible to this browser."}
        />
      </div>

      {state.audioDataUri ? (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Exact generated TTS — direct browser playback</div>
          <audio
            ref={audioRef}
            src={state.audioDataUri}
            controls
            className="h-10 w-full"
            onPlay={() => onPlaybackState({ directPlayback: "playing" })}
            onEnded={() => onPlaybackState({ directPlayback: "ended" })}
            onError={() => onPlaybackState({ directPlayback: "failed", directPlaybackError: "HTML audio element could not decode or play the generated TTS." })}
          />
        </div>
      ) : null}
    </section>
  );
}
