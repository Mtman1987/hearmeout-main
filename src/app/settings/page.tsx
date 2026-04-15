'use client';

import React, { useState, useEffect } from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import LeftSidebar from '@/app/components/LeftSidebar';
import { ThemeCustomizer } from '@/app/components/ThemeCustomizer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useSession } from '@/hooks/use-session';
import { useDoc } from '@/hooks/use-db';
import { dbUpdate } from '@/lib/db-helpers';
import { useToast } from '@/hooks/use-toast';
import { Bot, MessageCircle, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

function AdminRolesWarning() {
  const [status, setStatus] = useState<'loading' | 'configured' | 'not-configured'>('loading');

  useEffect(() => {
    const serverId = '1240832965865635881';
    fetch(`https://discord-stream-hub-new.fly.dev/api/db?path=servers/${serverId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const adminRoles = data?.data?.adminRoles || [];
        setStatus(adminRoles.length > 0 ? 'configured' : 'not-configured');
      })
      .catch(() => setStatus('not-configured'));
  }, []);

  if (status === 'loading' || status === 'configured') return null;

  return (
    <Alert variant="destructive">
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>Admin roles not configured</AlertTitle>
      <AlertDescription>
        No admin roles are set — HMO room controls are wide open. 
        <a href="https://discord-stream-hub-new.fly.dev/settings" target="_blank" className="underline font-medium ml-1">Configure in DSH Settings → Admin Role Configuration</a>
      </AlertDescription>
    </Alert>
  );
}

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
  const { user } = useSession();
  const { toast } = useToast();
  const [twitchChannel, setTwitchChannel] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const botAuthorized = params.get('bot_authorized');
    if (botAuthorized) {
      toast({ title: 'Success', description: `Bot authorized as ${botAuthorized}` });
      window.history.replaceState({}, '', '/settings');
    }
  }, [toast]);

  const [botData, setBotData] = useState<any>(null);
  const [discordData, setDiscordData] = useState<any>(null);

  useEffect(() => {
    fetch('/api/db?collection=config&id=twitch_bot')
      .then(res => res.json())
      .then(result => { if (result.exists) setBotData(result.data); })
      .catch(console.error);

    // Check Discord OAuth tokens from DSH
    const serverId = '1240832965865635881';
    const apiKey = ''; // DSH allows same-origin GET without key, but cross-origin needs it
    const headers: Record<string, string> = {};
    // We're cross-origin from HMO to DSH, so we'd need the key
    // But the status endpoint doesn't use /api/db, so it should work
    fetch(`https://discord-stream-hub-new.fly.dev/api/discord/oauth/status?serverId=${serverId}`)
      .then(res => res.ok ? res.json() : null)
      .then(result => { if (result?.connected) setDiscordData({ ...result, username: result.user?.username }); })
      .catch(() => {});
  }, []);

  const { data: userData } = useDoc(user ? 'users' : null, user?.uid || null);

  React.useEffect(() => {
    if (userData?.twitchChannel && !twitchChannel) {
      setTwitchChannel(userData.twitchChannel);
    }
  }, [userData, twitchChannel]);

  const handleSaveTwitch = async () => {
    if (!user || !twitchChannel.trim()) return;
    setSaving(true);
    try {
      dbUpdate('users', user.uid, { twitchChannel: twitchChannel.trim().toLowerCase() });
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
                            <AdminRolesWarning />
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
                                            value={twitchChannel}
                                            onChange={(e) => setTwitchChannel(e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">Bot will join your channel and respond to !sr, !np, !status commands</p>
                                    </div>
                                    <Button onClick={handleSaveTwitch} disabled={saving || !twitchChannel.trim()}>
                                        {saving ? 'Saving...' : 'Save Channel'}
                                    </Button>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Bot className="h-5 w-5" />
                                        Twitch Bot Status
                                    </CardTitle>
                                    <CardDescription>Bot tokens are managed through Discord Stream Hub</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {botData ? (
                                        <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                                            <div className="w-2 h-2 bg-green-500 rounded-full" />
                                            <div>
                                                <p className="font-semibold text-green-800 dark:text-green-300">Connected as {botData.username}</p>
                                                {botData.updated_at && <p className="text-xs text-green-700 dark:text-green-400">Updated: {new Date(botData.updated_at).toLocaleString()}</p>}
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">
                                            Not connected. <a href="https://discord-stream-hub-new.fly.dev/settings" target="_blank" className="underline font-medium">Authorize in DSH Settings</a>
                                        </p>
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <MessageCircle className="h-5 w-5" />
                                        Discord Bot Status
                                    </CardTitle>
                                    <CardDescription>Discord OAuth tokens are managed through Discord Stream Hub</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {discordData ? (
                                        <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg">
                                            <div className="w-2 h-2 bg-indigo-500 rounded-full" />
                                            <div>
                                                <p className="font-semibold text-indigo-800 dark:text-indigo-300">Connected{discordData.username ? ` as ${discordData.username}` : ''}</p>
                                                {discordData.updatedAt && <p className="text-xs text-indigo-700 dark:text-indigo-400">Updated: {new Date(discordData.updatedAt).toLocaleString()}</p>}
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">
                                            Not connected. <a href="https://discord-stream-hub-new.fly.dev/settings" target="_blank" className="underline font-medium">Authorize in DSH Settings</a>
                                        </p>
                                    )}
                                </CardContent>
                            </Card>

                            <ThemeCustomizer />
                        </div>
                    </main>
                </div>
            </SidebarInset>
        </div>
    </SidebarProvider>
  );
}
