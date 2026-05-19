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
import { Bot, MessageCircle, Rocket, ShieldAlert, RefreshCw } from 'lucide-react';
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
  const [discordBotStatus, setDiscordBotStatus] = useState<'loading' | 'running' | 'not-initialized' | 'error'>('loading');
  const [discordBotListeners, setDiscordBotListeners] = useState<number | null>(null);
  const [discordBotRunning, setDiscordBotRunning] = useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const botAuthorized = params.get('bot_authorized');
    if (botAuthorized) {
      toast({ title: 'Success', description: `Bot authorized as ${botAuthorized}` });
      window.history.replaceState({}, '', '/settings');
    }
  }, [toast]);

  const refreshDiscordBotStatus = React.useCallback(async () => {
    try {
      const res = await fetch('/api/discord-bot', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setDiscordBotStatus(data.status === 'running' ? 'running' : 'not-initialized');
      setDiscordBotListeners(typeof data.listenerCount === 'number' ? data.listenerCount : null);
    } catch (error) {
      console.error('Failed to refresh Discord bot status:', error);
      setDiscordBotStatus('error');
      setDiscordBotListeners(null);
    }
  }, []);

  React.useEffect(() => {
    refreshDiscordBotStatus();
  }, [refreshDiscordBotStatus]);

  const [botData, setBotData] = useState<any>(null);

  useEffect(() => {
    // Check local bot config first, then try DSH
    fetch(`/api/db?collection=config&id=twitch_bot`)
      .then(res => res.json())
      .then(result => {
        if (result.exists && result.data) {
          setBotData(result.data);
        } else {
          // Fallback: check DSH for cross-app token
          const serverId = process.env.NEXT_PUBLIC_HARDCODED_GUILD_ID || '1240832965865635881';
          fetch(`https://discord-stream-hub-new.fly.dev/api/db?path=users/twitch_${serverId}`)
            .then(r => r.json())
            .then(d => { if (d.exists && d.data) setBotData(d.data); })
            .catch(() => {});
        }
      })
      .catch(console.error);
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

  const handleRunDiscordBot = async () => {
    setDiscordBotRunning(true);
    try {
      const res = await fetch('/api/discord-bot?action=restart', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Bot restart failed (${res.status})`);
      }
      setDiscordBotStatus(data.status === 'restarted' ? 'running' : 'not-initialized');
      setDiscordBotListeners(typeof data.listenerCount === 'number' ? data.listenerCount : null);
      toast({
        title: 'Bot started',
        description: `Discord bot listeners running: ${data.listenerCount ?? 0}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to run Discord bot.';
      setDiscordBotStatus('error');
      toast({ variant: 'destructive', title: 'Bot error', description: message });
    } finally {
      setDiscordBotRunning(false);
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
                                    <CardDescription>Authorize a Twitch bot account for chat commands (!sr, !np, !status)</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {botData ? (
                                        <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                                            <div className="w-2 h-2 bg-green-500 rounded-full" />
                                            <div>
                                                <p className="font-semibold text-green-800 dark:text-green-300">Connected as {botData.username || botData.botUsername}</p>
                                                {botData.updated_at && <p className="text-xs text-green-700 dark:text-green-400">Updated: {new Date(botData.updated_at).toLocaleString()}</p>}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <p className="text-sm text-muted-foreground">
                                                No bot account connected. Authorize a Twitch account to use as the bot.
                                            </p>
                                            <Button
                                                onClick={() => {
                                                    const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || 'rxmohc28tthq0nudfd6iwx0sgy88dp';
                                                    const baseUrl = window.location.origin;
                                                    const redirectUri = `${baseUrl}/api/auth/twitch/callback`;
                                                    const scopes = 'chat:read+chat:edit+channel:moderate';
                                                    const url = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopes}&state=twitch_bot`;
                                                    window.location.href = url;
                                                }}
                                                variant="outline"
                                            >
                                                <Bot className="mr-2 h-4 w-4" />
                                                Authorize Twitch Bot Account
                                            </Button>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <MessageCircle className="h-5 w-5" />
                                        Discord Bot Status
                                    </CardTitle>
                                    <CardDescription>Discord bot token is set via environment variable (DISCORD_BOT_TOKEN)</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg">
                                            <div className={`w-2 h-2 rounded-full ${discordBotStatus === 'running' ? 'bg-green-500' : discordBotStatus === 'error' ? 'bg-red-500' : 'bg-indigo-500'}`} />
                                            <div className="min-w-0">
                                                <p className="font-semibold text-indigo-800 dark:text-indigo-300">
                                                    {discordBotStatus === 'running' ? 'Bot running' : discordBotStatus === 'error' ? 'Bot error' : 'Bot ready to run'}
                                                </p>
                                                <p className="text-xs text-indigo-700 dark:text-indigo-400">
                                                    {discordBotListeners !== null ? `${discordBotListeners} listener${discordBotListeners === 1 ? '' : 's'} active` : 'Refresh to check current listener count'}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap gap-2">
                                            <Button onClick={handleRunDiscordBot} disabled={discordBotRunning}>
                                                {discordBotRunning ? (
                                                    <>
                                                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                        Running...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Rocket className="mr-2 h-4 w-4" />
                                                        Run Bot
                                                    </>
                                                )}
                                            </Button>
                                            <Button type="button" variant="outline" onClick={refreshDiscordBotStatus}>
                                                <RefreshCw className="mr-2 h-4 w-4" />
                                                Refresh Status
                                            </Button>
                                        </div>

                                        {process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID ? (
                                            <p className="text-xs text-muted-foreground">
                                                App ID: {process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID}
                                            </p>
                                        ) : null}
                                    </div>
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
