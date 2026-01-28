'use client';

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import Playlist from "./Playlist";
import type { PlaylistItem } from "@/types/playlist";
import { ListMusic } from "lucide-react";
import { Button } from "@/components/ui/button";

type PlaylistPanelProps = {
    playlist: PlaylistItem[];
    onPlaySong: (songId: string) => void;
    currentTrackId: string;
    isPlayerControlAllowed: boolean;
    onRemoveSong: (songId: string) => void;
    onClearPlaylist: () => void;
}

export default function PlaylistPanel({ playlist, onPlaySong, currentTrackId, isPlayerControlAllowed, onRemoveSong, onClearPlaylist }: PlaylistPanelProps) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-headline flex items-center gap-2">
                    <ListMusic /> Up Next
                </CardTitle>
                 {isPlayerControlAllowed && playlist.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={onClearPlaylist}>Clear</Button>
                )}
            </CardHeader>
            <CardContent className="p-0">
                <Playlist 
                    playlist={playlist} 
                    onPlaySong={onPlaySong} 
                    currentTrackId={currentTrackId} 
                    isPlayerControlAllowed={isPlayerControlAllowed}
                    onRemoveSong={onRemoveSong}
                 />
            </CardContent>
        </Card>
    )
}
