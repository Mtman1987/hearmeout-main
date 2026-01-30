'use client';

import React from 'react';
import { MessageSquare, Music, ListMusic, Users } from 'lucide-react';
import * as LivekitClient from 'livekit-client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';

export default function OverlayCard({ participant, roomId }: { participant: LivekitClient.Participant; roomId: string }) {
  const { toast } = useToast();

  const toggleOverlayWidget = (widget: string) => {
    const saved = localStorage.getItem('overlay-visible');
    const visible = saved ? JSON.parse(saved) : { chat: true, music: true, queue: true };
    visible[widget] = !visible[widget];
    localStorage.setItem('overlay-visible', JSON.stringify(visible));
    window.dispatchEvent(new Event('storage'));
  };

  const showHiddenUsers = () => {
    const savedUsers = localStorage.getItem('overlay-hidden-users');
    const hiddenUsers = savedUsers ? JSON.parse(savedUsers) : [];
    if (hiddenUsers.length > 0) {
      localStorage.setItem('overlay-hidden-users', JSON.stringify([]));
      window.dispatchEvent(new Event('storage'));
      toast({ title: 'Profiles Restored', description: `${hiddenUsers.length} hidden profile(s) restored` });
    }
  };

  return (
    <Card className="flex flex-col h-full">
      <CardContent className="p-4 flex flex-col gap-4 flex-grow">
        <div className="flex items-start gap-4">
          <div className="relative">
            <Avatar className="h-16 w-16">
              <AvatarImage src="https://api.dicebear.com/7.x/shapes/svg?seed=overlay" alt="Overlay" />
              <AvatarFallback>OV</AvatarFallback>
            </Avatar>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-lg truncate">Overlay</p>
            <div className='flex items-center gap-1 text-muted-foreground'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleOverlayWidget('chat')}>
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Toggle Chat</p></TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleOverlayWidget('music')}>
                    <Music className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Toggle Music</p></TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleOverlayWidget('queue')}>
                    <ListMusic className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Toggle Queue</p></TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={showHiddenUsers}>
                    <Users className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Show Hidden Profiles</p></TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
