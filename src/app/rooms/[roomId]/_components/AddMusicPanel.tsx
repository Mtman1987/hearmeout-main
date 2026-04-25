'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Youtube, Upload, LoaderCircle, Search } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PlaylistItem } from "@/types/playlist";
import { getYoutubeInfo } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';

type AddMusicPanelProps = {
    onAddItems: (items: PlaylistItem[]) => void;
    onClose: () => void;
    canAddMusic: boolean;
};

export default function AddMusicPanel({ onAddItems, onClose, canAddMusic }: AddMusicPanelProps) {
    const [urlValue, setUrlValue] = useState("");
    const [searchValue, setSearchValue] = useState("");
    const [isFetching, setIsFetching] = useState(false);
    const { toast } = useToast();

    const handleAddItem = async (query: string) => {
        if (!query.trim() || isFetching || !canAddMusic) return;

        setIsFetching(true);
        const newItems = await getYoutubeInfo(query);
        setIsFetching(false);

        if (newItems && newItems.length > 0) {
            onAddItems(newItems);
            setUrlValue("");
            setSearchValue("");
            toast({
                title: "Music Added!",
                description: newItems.length > 1 ? `${newItems.length} songs have been added to the queue.` : `"${newItems[0].title}" has been added to the queue.`,
            })
        } else {
            toast({
                variant: 'destructive',
                title: 'Failed to fetch music',
                description: 'Could not get information for the provided query. The video might be private, region-locked, or the URL may be incorrect.',
            });
        }
    };

    if (!canAddMusic) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-2">
                        <Youtube /> Add Music
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className='p-4 text-sm text-muted-foreground'>You must be signed in to add music.</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <Youtube /> Add Music
                </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
                <Tabs defaultValue="url" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="url">
                            <Youtube className="mr-2" />
                            From URL
                        </TabsTrigger>
                        <TabsTrigger value="search">
                            <Search className="mr-2" />
                            Search
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="url" className="mt-4">
                        <div className="flex gap-2">
                            <Input
                                placeholder="YouTube video or playlist URL"
                                value={urlValue}
                                onChange={e => setUrlValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleAddItem(urlValue);
                                    }
                                }}
                                disabled={isFetching}
                            />
                            <Button variant="outline" onClick={() => handleAddItem(urlValue)} disabled={isFetching || !urlValue.trim()}>
                                {isFetching && urlValue ? <LoaderCircle className="animate-spin" /> : 'Add'}
                            </Button>
                        </div>
                    </TabsContent>
                    <TabsContent value="search" className="mt-4">
                         <div className="flex gap-2">
                            <Input
                                placeholder="Song name, artist, etc."
                                value={searchValue}
                                onChange={e => setSearchValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleAddItem(searchValue);
                                    }
                                }}
                                disabled={isFetching}
                            />
                            <Button variant="outline" onClick={() => handleAddItem(searchValue)} disabled={isFetching || !searchValue.trim()}>
                                {isFetching && searchValue ? <LoaderCircle className="animate-spin" /> : 'Search'}
                            </Button>
                        </div>
                    </TabsContent>
                </Tabs>
                <div className='flex items-center gap-2 mt-4'>
                    <div className='flex-1 border-t'></div>
                    <span className='text-xs text-muted-foreground'>OR</span>
                    <div className='flex-1 border-t'></div>
                </div>
                 <Button variant="outline" className='w-full mt-4' disabled>
                    <Upload className="mr-2" />
                    Upload Local Audio File (Coming Soon)
                </Button>
            </CardContent>
        </Card>
    );
}
