import Image from "next/image";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Music, Trash2 } from "lucide-react";
import placeholderData from "@/lib/placeholder-images.json";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { PlaylistItem } from "@/types/playlist";

export default function Playlist({ playlist, onPlaySong, currentTrackId, isPlayerControlAllowed, onRemoveSong }: { 
    playlist: PlaylistItem[], 
    onPlaySong: (songId: string) => void, 
    currentTrackId: string, 
    isPlayerControlAllowed: boolean,
    onRemoveSong: (songId: string) => void
}) {
  
  if (!playlist || playlist.length === 0) {
    return (
        <div className="h-64 w-full flex items-center justify-center">
            <p className="text-muted-foreground text-sm">Playlist is empty.</p>
        </div>
    )
  }

  return (
    <ScrollArea className="h-64 w-full">
      <ul className="space-y-1 p-2">
        {playlist.map((item) => {
          const art = placeholderData.placeholderImages.find(p => p.id === item.artId);
          const isPlaying = item.id === currentTrackId;

          return (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-2 p-2 rounded-md transition-colors group",
                isPlayerControlAllowed && "cursor-pointer hover:bg-secondary",
                isPlaying && "bg-secondary font-semibold"
              )}
              onClick={() => isPlayerControlAllowed && onPlaySong(item.id)}
            >
              {art && 
                <div className="relative w-10 h-10 shrink-0">
                    <Image
                        src={art.imageUrl}
                        alt={item.title}
                        fill
                        sizes="40px"
                        className="rounded-md object-cover"
                        data-ai-hint={art.imageHint}
                    />
                </div>
              }
              <div className="flex-1 overflow-hidden min-w-0">
                <p className="truncate">{item.title}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {item.artist}
                </p>
              </div>
              {isPlaying && <Music className="h-5 w-5 text-primary shrink-0" />}
              
              {isPlayerControlAllowed && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation(); // prevent playing the song when clicking delete
                    onRemoveSong(item.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                   <span className="sr-only">Remove song</span>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
