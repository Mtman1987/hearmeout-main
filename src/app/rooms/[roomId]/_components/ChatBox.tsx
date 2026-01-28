
"use client";

import React, { useState, useRef, useEffect } from "react";
import { useParams } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Send, Info, ShieldAlert, Smile, Frown, Meh, LoaderCircle } from "lucide-react";
import { runModeration } from "@/app/actions";
import type { ModerateContentOutput } from "@/ai/flows/sentiment-based-moderation";
import { useCollection, useFirebase, useMemoFirebase, addDocumentNonBlocking } from "@/firebase";
import { collection, query, orderBy, serverTimestamp } from "firebase/firestore";

interface ChatMessage {
  id: string;
  text: string;
  displayName: string;
  userId: string;
  createdAt: any;
}


export default function ChatBox() {
  const [input, setInput] = useState("");
  const [moderationResult, setModerationResult] = useState<ModerateContentOutput | null>(null);
  const [isPending, setIsPending] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { firestore, user } = useFirebase();
  const params = useParams();
  const roomId = params.roomId as string;

  const messagesRef = useMemoFirebase(() => {
    if (!firestore || !roomId) return null;
    return collection(firestore, 'rooms', roomId, 'messages');
  }, [firestore, roomId]);

  const messagesQuery = useMemoFirebase(() => {
      if (!messagesRef) return null;
      return query(messagesRef, orderBy('createdAt', 'asc'));
  }, [messagesRef]);

  const { data: messages, isLoading: messagesLoading } = useCollection<ChatMessage>(messagesQuery);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (viewport) {
        setTimeout(() => {
            viewport.scrollTop = viewport.scrollHeight;
        }, 0);
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isPending || !user || !messagesRef) return;

    const displayName = user.displayName || 'Anonymous';

    const newMessage = {
      text: input.trim(),
      userId: user.uid,
      displayName: displayName,
      createdAt: serverTimestamp(),
    };
    
    addDocumentNonBlocking(messagesRef, newMessage);
    setInput("");

    const currentMessages = messages || [];
    const conversationHistory = [...currentMessages, { displayName: newMessage.displayName, text: newMessage.text }]
        .map(msg => `${msg.displayName}: ${msg.text}`)
        .join('\n');
    
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
  }

  return (
    <Card className="flex flex-col h-full w-full border-0 shadow-none rounded-none bg-transparent">
      <CardHeader className="p-4 md:p-6">
        <CardTitle className="font-headline flex items-center gap-2">
          Chat & Moderation
        </CardTitle>
        <CardDescription>
          Conversation is monitored for safety.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4 overflow-hidden p-4 md:p-6 pt-0">
        <ScrollArea className="flex-1 pr-4 -mr-4" ref={scrollAreaRef}>
          <div className="space-y-4">
            {messagesLoading && (
                <div className="flex justify-center items-center h-full">
                    <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                </div>
            )}
            {!messagesLoading && messages && messages.map((msg) => (
              <p key={msg.id} className="text-sm">
                <span className="font-bold text-primary mr-2">
                  {msg.userId === user?.uid ? 'You' : msg.displayName}:
                </span>
                {msg.text}
              </p>
            ))}
             {!messagesLoading && (!messages || messages.length === 0) && (
              <div className="text-center text-muted-foreground py-8">
                No messages yet. Start the conversation!
              </div>
            )}
          </div>
        </ScrollArea>
        {moderationResult && (
            <Alert variant={moderationResult.isHarmful ? "destructive" : "default"}>
                <SentimentIcon />
                <AlertTitle className="font-headline">
                    {moderationResult.isHarmful ? 'Harmful Content Detected' : 'Sentiment Analysis'}
                </AlertTitle>
                <AlertDescription>
                    {moderationResult.isHarmful 
                        ? moderationResult.alertReason 
                        : `Overall sentiment: ${moderationResult.overallSentiment}`
                    }
                </AlertDescription>
            </Alert>
        )}
      </CardContent>
      <CardFooter className="p-4 md:p-6 pt-0">
        <form onSubmit={handleSubmit} className="flex w-full items-center space-x-2">
          <Textarea
            placeholder={user ? "Type your message here..." : "Sign in to chat"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            disabled={isPending || !user}
          />
          <Button type="submit" size="icon" disabled={isPending || !input.trim() || !user}>
            <Send className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
