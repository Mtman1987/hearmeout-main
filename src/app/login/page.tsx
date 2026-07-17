'use client';

import { useEffect, useState, Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Logo } from "@/app/components/Logo";
import Link from "next/link";
import { ChevronLeft, LoaderCircle } from "lucide-react";
import { useSession } from '@/hooks/use-session';
import { useRouter, useSearchParams } from 'next/navigation';


function LoginContent() {
  const { user, isLoading, refresh } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const errorParam = searchParams?.get('error');
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      return;
    }

    // Handle Discord auth success from DSH
    const discordAuth = searchParams?.get('discord_auth');
    const userId = searchParams?.get('user_id');
    const username = searchParams?.get('username');
    if (discordAuth === 'success' && userId && username) {
      // The signed hmo_session cookie is authoritative. Query parameters are
      // only callback hints and must not become a second browser-only session.
      refresh().then(() => router.push('/'));
      return;
    }

    // If we got redirected back with success=true, refresh session
    const success = searchParams?.get('success');
    if (success) {
      refresh().then(() => router.push('/'));
      return;
    }

    if (user && !isLoading) {
      router.push('/');
    }
  }, [searchParams, user, isLoading, router, refresh]);

    // Legacy OAuth - now handled by auto login

  const handleAutoLogin = async () => {
    window.location.href = '/api/auth/spmt/login';
  };

  const handleDiscordLink = async () => {
    window.location.href = '/api/auth/discord/callback';
  };

  const handleGuestLogin = async () => {
    const res = await fetch('/api/auth/guest', { method: 'POST' });
    if (res.ok) {
      await refresh();
      router.push('/');
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-secondary">
        <LoaderCircle className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-secondary p-4 relative">
      <Button variant="ghost" asChild className="absolute top-4 left-4">
        <Link href="/">
          <ChevronLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Link>
      </Button>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mb-4 flex justify-center">
            <Logo />
          </div>
          <CardTitle className="font-headline text-2xl">Join the Conversation</CardTitle>
          <CardDescription>
            Sign in to create rooms and start listening.
          </CardDescription>
          {error && (
            <div className="mt-4 text-sm text-red-600 bg-red-50 p-2 rounded">
              {error}
            </div>
          )}
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button className="w-full" onClick={handleAutoLogin}>
            <span>Continue with SPMT</span>
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            Your SPMT account is the suite identity. Discord and Twitch remain linked providers.
          </div>
          <Button variant="outline" className="w-full" onClick={handleDiscordLink}>
            <span>Link through Discord Stream Hub</span>
          </Button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>
          <Button variant="secondary" className="w-full" onClick={handleGuestLogin}>
            Continue as Guest
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen w-full items-center justify-center bg-secondary">
        <LoaderCircle className="h-10 w-10 animate-spin text-primary" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
