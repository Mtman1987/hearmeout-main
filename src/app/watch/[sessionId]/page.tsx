import WatchRoomClient from './watch-room-client';

export default async function WatchRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ canPause?: string; host?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const canPause = query.canPause === '1' || query.host === '1';
  return <WatchRoomClient sessionId={sessionId} canPause={canPause} />;
}
