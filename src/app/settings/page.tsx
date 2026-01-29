'use client';

import React, { useState } from 'react';
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import LeftSidebar from '@/app/components/LeftSidebar';
import { ThemeCustomizer } from '@/app/components/ThemeCustomizer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useFirebase, useMemoFirebase, useDoc } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';


function SettingsHeader() {
    const { isMobile } = useSidebar();
    return (
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6">
            <SidebarTrigger className={isMobile ? "" : "hidden md:flex"} />
            <h2 className="text-xl font-bold font-headline truncate flex-1">Settings</h2>
        </header>
    );
}

export default function SettingsPage() {
  const { user, firestore } = useFirebase();
  const { toast } = useToast();
  const [twitchChannel, setTwitchChannel] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    
    if (code && state === 'twitch_bot') {
      fetch('/api/twitch/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            toast({ title: 'Success', description: `Bot authorized as ${data.username}` });
            window.history.replaceState({}, '', '/settings');
          }
        })
        .catch(console.error);
    }
  }, [toast]);

  const userDocRef = useMemoFirebase(() => user && firestore ? doc(firestore, 'users', user.uid) : null, [user, firestore]);
  const { data: userData } = useDoc(userDocRef);

  const handleSaveTwitch = async () => {
    if (!userDocRef || !twitchChannel.trim()) return;
    setSaving(true);
    try {
      await updateDoc(userDocRef, { twitchChannel: twitchChannel.trim().toLowerCase() });
      toast({ title: 'Saved', description: 'Twitch channel updated. Bot will join within 30 seconds.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save Twitch channel.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SidebarProvider>
        <LeftSidebar />
        <div className="bg-secondary/30 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width-icon)_+_1rem)] md:peer-data-[variant=inset]:ml-[calc(var(--sidebar-width)_+_1rem)] duration-200 transition-[margin-left]">
            <SidebarInset>
                <div className="flex flex-col h-screen">
                    <SettingsHeader />
                    <main className="flex-1 p-4 md:p-6">
                        <div className="max-w-xl mx-auto space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Twitch Integration</CardTitle>
                                    <CardDescription>Connect your Twitch channel to enable bot commands</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="twitch">Twitch Channel Name</Label>
                                        <Input 
                                            id="twitch"
                                            placeholder="your_channel_name"
                                            value={twitchChannel || userData?.twitchChannel || ''}
                                            onChange={(e) => setTwitchChannel(e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">Bot will join your channel and respond to !sr, !np, !status commands</p>
                                    </div>
                                    <Button onClick={handleSaveTwitch} disabled={saving || !twitchChannel.trim()}>
                                        {saving ? 'Saving...' : 'Save Channel'}
                                    </Button>
                                </CardContent>
                            </Card>
                            
                            {user?.uid === 'discord_767875979561009173' && (
                              <Card>
                                <CardHeader>
                                  <CardTitle>Twitch Bot OAuth</CardTitle>
                                  <CardDescription>Authorize the global Twitch bot account</CardDescription>
                                </CardHeader>
                                <CardContent>
                                  <Button
                                    onClick={() => {
                                      const redirectUri = `${window.location.origin}/settings`;
                                      const scope = 'chat:read chat:edit';
                                      window.location.href = `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=twitch_bot`;
                                    }}
                                  >
                                    Authorize Bot Account
                                  </Button>
                                </CardContent>
                              </Card>
                            )}
                            <ThemeCustomizer />
                        </div>
                    </main>
                </div>
            </SidebarInset>
        </div>
    </SidebarProvider>
  );
}
