"use client";

import React, { useState, useRef, useEffect, useContext } from "react";
import { useParams } from "next/navigation";
import { RoomContext } from "@livekit/components-react";
import { RoomEvent, type RemoteParticipant } from "livekit-client";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Send, Info, ShieldAlert, Smile, Frown, Meh, LoaderCircle, MessageSquare, Radio, Hash } from "lucide-react";
import { runModeration } from "@/app/actions";
import type { ModerateContentOutput } from "@/ai/flows/sentiment-based-moderation";
import { useSession } from "@/hooks/use-session";
import { isPersonaParticipant, parsePersonaMetadata } from "./PersonaCard";

interface AdminChatMessage {
  id: string;
  username: string;
  text: string;
  timestamp: string;
}

export type RoomBotDescriptor = {
  displayName: string;
  wakeNames: string[];
};

interface ChatBoxProps {
  roomId?: string;
  compact?: boolean;
  onOpenSpaceChat?: () => void;
  onOpenTwitchChat?: () => void;
  onOpenDiscordChat?: () => void;
  botParticipants?: RoomBotDescriptor[];
}

type BotInvocation = {
  displayName: string;
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesWakeName(value: string, wakeName: string) {
  const normalized = String(wakeName || "").trim().replace(/^@/, "");
  if (!normalized) return false;
  return new RegExp(`^\\s*@?${escapeRegex(normalized)}\\b`, "i").test(value);
}

export function resolveBotInvocation(
  value: string,
  bots: RoomBotDescriptor[] = [],
): BotInvocation | null {
  for (const bot of bots) {
    if (bot.wakeNames.some((wakeName) => matchesWakeName(value, wakeName))) {
      return { displayName: bot.displayName };
    }
  }

  if (bots.length === 1 && matchesWakeName(value, "bot")) {
    return { displayName: bots[0].displayName };
  }

  // Compatibility only. Existing rooms and bookmarks may still address Athena
  // before a bot participant is connected. The request itself still goes
  // through the same tenant-generic SPMT/StreamWeaver bot runtime.
  if (/^\s*@?athena(?:\s*os)?\b/i.test(value)) {
    return { displayName: "Athena" };
  }

  return null;
}

function participantDescriptors(participants: RemoteParticipant[]): RoomBotDescriptor[] {
  return participants
    .filter(isPersonaParticipant)
    .map((participant) => {
      const metadata = parsePersonaMetadata(participant.metadata) || {};
      const identityName = participant.identity.replace(/^persona:/, "");
      const displayName = metadata.displayName
        || participant.name
        || identityName
        || "StreamWeaver Bot";
      const wakeNames = Array.from(new Set([
        displayName,
        metadata.personaId,
        participant.name,
        identityName,
      ].map((entry) => String(entry || "").trim()).filter(Boolean)));
      return { displayName, wakeNames };
    });
}

export default function ChatBox({ roomId, compact = false, onOpenSpaceChat, onOpenTwitchChat, onOpenDiscordChat, botParticipants }: ChatBoxProps) {
  const params = useParams<{ roomId?: string }>();
  const activeRoomId = roomId || params?.roomId;
  const [input, setInput] = useState("");
  const [moderationResult, setModerationResult] = useState<ModerateContentOutput | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [messages, setMessages] = useState<AdminChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [liveKitBots, setLiveKitBots] = useState<RoomBotDescriptor[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { user } = useSession();
  const room = useContext(RoomContext);
  const activeBotParticipants = botParticipants ?? liveKitBots;

  useEffect(() => {
    if (!room) {
      setLiveKitBots([]);
      return;
    }

    const refreshBotParticipants = () => {
      setLiveKitBots(participantDescriptors(Array.from(room.remoteParticipants.values())));
    };

    refreshBotParticipants();
    room.on(RoomEvent.ParticipantConnected, refreshBotParticipants);
    room.on(RoomEvent.ParticipantDisconnected, refreshBotParticipants);
    room.on(RoomEvent.ParticipantMetadataChanged, refreshBotParticipants);
    return () => {
      room.off(RoomEvent.ParticipantConnected, refreshBotParticipants);
      room.off(RoomEvent.ParticipantDisconnected, refreshBotParticipants);
      room.off(RoomEvent.ParticipantMetadataChanged, refreshBotParticipants);
    };
  }, [room]);

  const fetchAdminChat = async () => {
    try {
      const response = await fetch("/api/admin-chat");
      if (response.ok) {
        const data = await response.json();
        setMessages((data.messages || []).slice(-100));
      }
    } catch (error) {
      console.error("Failed to fetch admin chat:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const sendToAdminChat = async (message: AdminChatMessage) => {
    try {
      const response = await fetch("/api/admin-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (response.ok) {
        setMessages((prev) => [...prev, message].slice(-100));
      }
    } catch (error) {
      console.error("Failed to send admin chat message:", error);
    }
  };

  const sendToBot = async (command: string, fallbackDisplayName: string) => {
    const response = await fetch("/api/bot/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command,
        roomId: activeRoomId,
        // Text chat only needs the response text. Voice callers can request
        // synthesized audio from the same canonical SPMT bot route.
        speak: false,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload?.error || `Bot runtime returned ${response.status}`));
    }
    return {
      reply: String(payload?.response || payload?.data?.response || "").trim(),
      botName: String(
        payload?.bot?.name
        || payload?.data?.bot?.name
        || fallbackDisplayName
        || "StreamWeaver Bot",
      ).trim(),
    };
  };

  useEffect(() => {
    fetchAdminChat();
    const interval = setInterval(fetchAdminChat, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (viewport) setTimeout(() => { viewport.scrollTop = viewport.scrollHeight; }, 0);
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isPending || !user) return;

    const submittedText = input.trim();
    const newMessage: AdminChatMessage = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      username: user.displayName || "HearMeOut User",
      text: submittedText,
      timestamp: new Date().toISOString(),
    };

    await sendToAdminChat(newMessage);
    setInput("");

    const conversationHistory = [...messages, newMessage]
      .map((msg) => `${msg.username}: ${msg.text}`).join("\n");

    setIsPending(true);
    try {
      const botInvocation = resolveBotInvocation(submittedText, activeBotParticipants);
      if (botInvocation) {
        try {
          const { reply, botName } = await sendToBot(submittedText, botInvocation.displayName);
          if (reply) {
            await sendToAdminChat({
              id: `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              username: botName,
              text: reply,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error("StreamWeaver bot command failed", error);
        }
      }

      const result = await runModeration(conversationHistory);
      setModerationResult(result);
    } catch (error) {
      console.error("Moderation failed", error);
    } finally {
      setIsPending(false);
    }
  };

  const SentimentIcon = () => {
    if (!moderationResult) return <Info className="h-4 w-4" />;
    if (moderationResult.isHarmful) return <ShieldAlert className="h-4 w-4" />;
    const sentiment = moderationResult.overallSentiment.toLowerCase();
    if (sentiment.includes("positive")) return <Smile className="h-4 w-4" />;
    if (sentiment.includes("negative")) return <Frown className="h-4 w-4" />;
    return <Meh className="h-4 w-4" />;
  };

  return (
    <Card className="flex flex-col h-full w-full border-0 shadow-none rounded-none bg-transparent" data-workspace-chat-surface>
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-headline text-base flex items-center gap-2">Space Mountain Chat</CardTitle>
          {!compact && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenSpaceChat} title="Pop out Space Mountain chat">
                <MessageSquare className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenTwitchChat} title="Pop out Twitch chat">
                <Radio className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenDiscordChat} title="Pop out Discord chat">
                <Hash className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden px-4 pb-0 pt-0">
        <ScrollArea className="flex-1 pr-4 -mr-4" ref={scrollAreaRef}>
          <div className="space-y-4">
            {isLoading && <div className="flex justify-center items-center h-full"><LoaderCircle className="h-6 w-6 animate-spin text-primary" /></div>}
            {!isLoading && messages && messages.map((msg) => {
              const isCurrentUser = msg.username === (user?.displayName || "HearMeOut User");
              const timestamp = new Date(msg.timestamp);
              const timeStr = timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

              return (
                <div key={msg.id} className="text-sm">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={`font-bold ${isCurrentUser ? "text-green-600 dark:text-green-400" : "text-primary"}`}>
                      {isCurrentUser ? "You" : msg.username}
                    </span>
                    <span className="text-xs text-muted-foreground">{timeStr}</span>
                  </div>
                  <div className="text-foreground pl-2 border-l-2 border-muted">{msg.text}</div>
                </div>
              );
            })}
            {!isLoading && (!messages || messages.length === 0) && (
              <div className="text-center text-muted-foreground py-8">No messages yet. Start the conversation.</div>
            )}
          </div>
        </ScrollArea>
        {moderationResult && (
          <Alert variant={moderationResult.isHarmful ? "destructive" : "default"}>
            <SentimentIcon />
            <AlertTitle className="font-headline">{moderationResult.isHarmful ? "Harmful Content Detected" : "Sentiment Analysis"}</AlertTitle>
            <AlertDescription>{moderationResult.isHarmful ? moderationResult.alertReason : `Overall sentiment: ${moderationResult.overallSentiment}`}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="px-4 py-3">
        <form onSubmit={handleSubmit} className="flex w-full items-center gap-2">
          <Textarea
            placeholder={user ? "Type a message..." : "Sign in to chat"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
            disabled={isPending || !user}
          />
          <Button type="submit" size="icon" className="shrink-0" disabled={isPending || !input.trim() || !user}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
