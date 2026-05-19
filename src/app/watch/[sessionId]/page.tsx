import WatchRoomClient from './watch-room-client';

export default async function WatchRoomPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <WatchRoomClient sessionId={sessionId} />;
}
