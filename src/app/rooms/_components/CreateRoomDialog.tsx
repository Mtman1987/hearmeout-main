'use client';

import { useState } from 'react';
import { useFirebase } from '@/firebase';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PlusCircle, LoaderCircle } from 'lucide-react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

export function CreateRoomDialog() {
  const { firestore, user } = useFirebase();
  const [open, setOpen] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [link1Label, setLink1Label] = useState('');
  const [link1Url, setLink1Url] = useState('');
  const [link2Label, setLink2Label] = useState('');
  const [link2Url, setLink2Url] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const handleCreateRoom = async () => {
    if (!user || !firestore) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'You must be logged in to create a room.',
      });
      return;
    }
    if (!roomName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please enter a room name.',
      });
      return;
    }

    setIsCreating(true);
    try {
      const roomsCollection = collection(firestore, 'rooms');
      const newRoomDoc = await addDoc(roomsCollection, {
        name: roomName,
        description: description,
        ownerId: user.uid,
        isPrivate: isPrivate,
        link1Label: link1Label.trim() || undefined,
        link1Url: link1Url.trim() || undefined,
        link2Label: link2Label.trim() || undefined,
        link2Url: link2Url.trim() || undefined,
        createdAt: serverTimestamp(),
      });

      // Reset form
      setRoomName('');
      setDescription('');
      setIsPrivate(false);
      setLink1Label('');
      setLink1Url('');
      setLink2Label('');
      setLink2Url('');
      setOpen(false);

      toast({
        title: 'Room Created!',
        description: `"${roomName}" has been successfully created.`,
      });

      // Redirect to the new room
      router.push(`/rooms/${newRoomDoc.id}`);
    } catch (error) {
      console.error('Error creating room:', error);
      toast({
        variant: 'destructive',
        title: 'Uh oh! Something went wrong.',
        description: 'Could not create the room. Please try again.',
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full" disabled={!user}>
          <PlusCircle />
          Create Room
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create a new room</DialogTitle>
          <DialogDescription>
            Give your room a name and invite your friends to listen along.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              Name
            </Label>
            <Input
              id="name"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="col-span-3"
              placeholder="e.g., Lofi Beats"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="description" className="text-right">
              Description
            </Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="col-span-3"
              placeholder="e.g., Chillhop and lofi to relax/study to"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="is-private" className="text-right">
              Private
            </Label>
            <div className="col-span-3">
              <Switch
                id="is-private"
                checked={isPrivate}
                onCheckedChange={setIsPrivate}
              />
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="link1-label" className="text-right text-xs">
              Link 1 Label
            </Label>
            <Input
              id="link1-label"
              value={link1Label}
              onChange={(e) => setLink1Label(e.target.value)}
              className="col-span-3"
              placeholder="e.g., Twitch, YouTube"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="link1-url" className="text-right text-xs">
              Link 1 URL
            </Label>
            <Input
              id="link1-url"
              value={link1Url}
              onChange={(e) => setLink1Url(e.target.value)}
              className="col-span-3"
              placeholder="https://..."
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="link2-label" className="text-right text-xs">
              Link 2 Label
            </Label>
            <Input
              id="link2-label"
              value={link2Label}
              onChange={(e) => setLink2Label(e.target.value)}
              className="col-span-3"
              placeholder="e.g., Discord, TikTok"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="link2-url" className="text-right text-xs">
              Link 2 URL
            </Label>
            <Input
              id="link2-url"
              value={link2Url}
              onChange={(e) => setLink2Url(e.target.value)}
              className="col-span-3"
              placeholder="https://..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleCreateRoom} disabled={isCreating}>
            {isCreating ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              'Create Room'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
