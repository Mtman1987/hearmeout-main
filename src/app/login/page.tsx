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
import { useFirebase } from '@/firebase';
import { 
    signInAnonymously, 
    updateProfile, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useRouter, useSearchParams } from 'next/navigation';


const DiscordIcon = () => (
    <svg role="img" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M16.29 5.23a10.08 10.08 0 0 0-2.2-.62.84.84 0 0 0-1 .75c.18.25.36.5.52.75a8.62 8.62 0 0 0-4.14 0c.16-.25.34-.5.52-.75a.84.84 0 0 0-1-.75 10.08 10.08 0 0 0-2.2.62.81.81 0 0 0-.54.78c-.28 3.24.78 6.28 2.82 8.25a.85.85 0 0 0 .93.12 7.55 7.55 0 0 0 1.45-.87.82.82 0 0 1 .9-.06 6.53 6.53 0 0 0 2.22 0 .82.82 0 0 1 .9.06 7.55 7.55 0 0 0 1.45.87.85.85 0 0 0 .93-.12c2.04-1.97 3.1-5 2.82-8.25a.81.81 0 0 0-.55-.78zM10 11.85a1.45 1.45 0 0 1-1.45-1.45A1.45 1.45 0 0 1 10 8.95a1.45 1.45 0 0 1 1.45 1.45A1.45 1.45 0 0 1 10 11.85zm4 0a1.45 1.45 0 0 1-1.45-1.45A1.45 1.45 0 0 1 14 8.95a1.45 1.45 0 0 1 1.45 1.45A1.45 1.45 0 0 1 14 11.85z"/>
    </svg>
);

const TwitchIcon = () => (
    <svg role="img" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M2.149 0L.537 4.119v16.845h5.373V24l4.298-2.985h3.582L22.388 12V0H2.149zm19.104 11.194l-3.582 3.582H14.18l-3.209 3.209v-3.209H5.91V1.493h15.343v9.701zM11.94 4.119h2.149v5.373h-2.149V4.119zm-5.373 0h2.149v5.373H6.567V4.119z"/>
    </svg>
);

const GoogleIcon = () => (
    <svg role="img" width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <g fill="none" fillRule="evenodd">
            <path d="M20.64 12.2045c0-.6381-.0573-1.2518-.1636-1.8409H12v3.4818h4.8436c-.2086 1.125-.8427 2.0782-1.7772 2.7118v2.2582h2.9087c1.7018-1.5668 2.6863-3.8741 2.6863-6.611z" fill="#4285F4"/>
            <path d="M12 21c2.43 0 4.4718-.8018 5.9645-2.1818l-2.9087-2.2582c-.8018.54-1.8368.8618-3.0558.8618-2.314 0-4.2695-1.5668-4.9682-3.6573H3.9573v2.3318C5.4382 18.9832 8.4818 21 12 21z" fill="#34A853"/>
            <path d="M7.0318 13.1818c-.184-.54-.2882-1.1168-.2882-1.7227s.1042-1.1827.2882-1.7227V7.4045H3.9573C3.3377 8.7618 3 10.3218 3 12c0 1.6782.3377 3.2382.9573 4.5955l3.0745-2.4137z" fill="#FBBC05"/>
            <path d="M12 6.9545c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5817C16.4632 4.0932 14.43 3 12 3c-3.5182 0-6.5618 2.0168-8.0427 4.9091L7.032 10.3227c.6987-2.0909 2.6546-3.6572 4.9682-3.6572z" fill="#EA4335"/>
        </g>
    </svg>
);


function LoginContent() {
  const { auth, firestore, user, isUserLoading } = useFirebase();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'authenticating' | 'idle'>('authenticating');
  const [error, setError] = useState<string | null>(null);
  const [isProcessingToken, setIsProcessingToken] = useState(false);

  useEffect(() => {
    const errorParam = searchParams?.get('error');
    const tokenParam = searchParams?.get('token');
    
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      setStatus('idle');
      return;
    }
    
    if (tokenParam && auth && !isProcessingToken) {
      setIsProcessingToken(true);
      import('firebase/auth').then(({ signInWithCustomToken }) => {
        signInWithCustomToken(auth, tokenParam)
          .then(() => {
            router.push('/');
          })
          .catch((err) => {
            console.error('Custom token sign-in failed:', err);
            setError('Authentication failed');
            setStatus('idle');
            setIsProcessingToken(false);
          });
      });
      return;
    }
    
    if (user && !tokenParam) {
      router.push('/');
    } else if (!isUserLoading && !tokenParam) {
      setStatus('idle');
    }
  }, [searchParams, auth, router, user, isUserLoading, isProcessingToken]);


  const handleGuestLogin = () => {
    if (auth) {
        setStatus('authenticating');
        signInAnonymously(auth).catch((error) => {
            console.error("Anonymous sign-in failed", error);
            setStatus('idle');
        });
    }
  };

  const handleDiscordOAuth = () => {
    const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/discord/callback`;
    const scopes = 'identify email';
    
    const discordAuthUrl = new URL('https://discord.com/api/oauth2/authorize');
    discordAuthUrl.searchParams.set('client_id', clientId!);
    discordAuthUrl.searchParams.set('redirect_uri', redirectUri);
    discordAuthUrl.searchParams.set('response_type', 'code');
    discordAuthUrl.searchParams.set('scope', scopes);

    window.location.href = discordAuthUrl.toString();
  };

  const handleTwitchOAuth = () => {
    const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
    const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/twitch/callback`;
    const scopes = 'user:read:email chat:read chat:edit';

    const twitchAuthUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    twitchAuthUrl.searchParams.set('client_id', clientId!);
    twitchAuthUrl.searchParams.set('redirect_uri', redirectUri);
    twitchAuthUrl.searchParams.set('response_type', 'code');
    twitchAuthUrl.searchParams.set('scope', scopes);

    window.location.href = twitchAuthUrl.toString();
  };

  const handleGoogleLogin = async () => {
    if (auth && firestore) {
      setStatus('authenticating');
      const email = "teddy.simulated@example.com";
      const password = "very-secure-simulation-password-123!";

      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (error: any) {
        if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
          try {
            await createUserWithEmailAndPassword(auth, email, password);
          } catch (createError: any) {
            console.error("Simulated user creation failed:", createError);
            setStatus('idle');
            return;
          }
        } else {
          console.error("Simulated sign-in failed:", error);
          setStatus('idle');
          return;
        }
      }

      const currentUser = auth.currentUser;
      if (currentUser) {
        const userInfo = {
            username: "Teddy",
            discordId: "149805185105920000",
            profilePicture: "https://cdn.discordapp.com/avatars/149805185105920000/dcf59f025ac52b6025b700f1bf1ce808.png"
        };
        try {
            await updateProfile(currentUser, {
                displayName: userInfo.username,
                photoURL: userInfo.profilePicture
            });
            const userRef = doc(firestore, 'users', currentUser.uid);
            await setDoc(userRef, {
                id: currentUser.uid,
                username: userInfo.username,
                email: currentUser.email,
                displayName: userInfo.username,
                profileImageUrl: userInfo.profilePicture,
                discordId: userInfo.discordId,
            }, { merge: true });
        } catch (error: any) {
            console.error("Failed to update profile:", error);
            setStatus('idle');
        }
      }
    }
  };
  
  if (status === 'authenticating' || isUserLoading || isProcessingToken) {
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
          <Button variant="outline" className="w-full" onClick={handleGoogleLogin}>
            <GoogleIcon />
            <span className="ml-2">Continue with Google</span>
          </Button>
          <Button variant="outline" className="w-full" onClick={handleDiscordOAuth}>
            <DiscordIcon />
            <span className="ml-2">Continue with Discord</span>
          </Button>
          <Button variant="outline" className="w-full" onClick={handleTwitchOAuth}>
            <TwitchIcon />
            <span className="ml-2">Continue with Twitch</span>
          </Button>
           <div className="relative">
            <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                Or
                </span>
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
