"use client";

import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Send, Info, ShieldAlert, Smile, Frown, Meh, LoaderCircle, MessageSquare, Radio, Hash } from "lucide-react";
import { runModeration } from "@/app/actions";
import type { ModerateContentOutput } from "@/ai/flows/sentiment-based-moderation";
import { useSession } from "@/hooks/use-session";

interface AdminChatMessage {
  id: string;
  username: string;
  text: string;
  timestamp: string;
}

interface ChatBoxProps {
  roomId?: string;
  compact?: boolean;
  onOpenSpaceChat?: () => void;
  onOpenTwitchChat?: () => void;
  onOpenDiscordChat?: () => void;
}

export default function ChatBox({ compact = false, onOpenSpaceChat, onOpenTwitchChat, onOpenDiscordChat }: ChatBoxProps) {
  const [input, setInput] = useState("");
  const [moderationResult, setModerationResult] = useState<ModerateContentOutput | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [messages, setMessages] = useState<AdminChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { user } = useSession();

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

    const newMessage: AdminChatMessage = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      username: user.displayName || "HearMeOut User",
      text: input.trim(),
      timestamp: new Date().toISOString(),
    };

    await sendToAdminChat(newMessage);
    setInput("");

    const conversationHistory = [...messages, newMessage]
      .map((msg) => `${msg.username}: ${msg.text}`).join("\n");

    setIsPending(true);
    try {
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
    <Card className="flex flex-col h-full w-full border-0 shadow-none rounded-none bg-transparent">
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
