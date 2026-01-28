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
        createdAt: serverTimestamp(),
      });

      // Reset form
      setRoomName('');
      setDescription('');
      setIsPrivate(false);
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
