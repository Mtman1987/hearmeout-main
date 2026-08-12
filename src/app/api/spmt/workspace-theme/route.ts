import { NextRequest, NextResponse } from 'next/server';
import { workspaceThemeTokens } from '@spmt/sdk';
import { HMO_SPMT_COOKIE, SPMT_BASE_URL } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(HMO_SPMT_COOKIE)?.value || '';
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const [profileResponse, personalResponse] = await Promise.all([
    fetch(`${SPMT_BASE_URL}/api/workspace-profile`, { headers, cache: 'no-store' }),
    fetch(`${SPMT_BASE_URL}/api/personal-overlay-launch`, { headers, cache: 'no-store' }),
  ]);
  const [payload, personalPayload] = await Promise.all([
    profileResponse.json().catch(() => null),
    personalResponse.json().catch(() => null),
  ]);
  if (!profileResponse.ok || !payload?.profile) {
    return NextResponse.json({ error: payload?.error || 'Workspace theme unavailable' }, { status: profileResponse.status || 502 });
  }

  return NextResponse.json({
    tokens: workspaceThemeTokens(payload.profile, 'hearmeout', null),
    personalOverlayUrl: personalResponse.ok && typeof personalPayload?.url === 'string' ? personalPayload.url : null,
    revision: payload.profile.revision,
    updatedAt: payload.profile.updatedAt,
  });
}
