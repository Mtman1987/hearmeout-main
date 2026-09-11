import { redirect } from 'next/navigation';
import { MUSIC_WATCH_SESSION_ID } from '@/lib/watch-session';
export default function DjPage() { redirect(`/activity?sessionId=${MUSIC_WATCH_SESSION_ID}`); }
