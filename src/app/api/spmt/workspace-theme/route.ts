import { NextRequest, NextResponse } from 'next/server';
import { workspaceThemeTokens } from '@spmt/sdk';
import { HMO_SPMT_COOKIE, SPMT_BASE_URL } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

type SurfaceDefinition = { id?: string; path?: string; url?: string };

function surfaceList(payload: unknown): SurfaceDefinition[] {
  if (Array.isArray(payload)) return payload as SurfaceDefinition[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { surfaces?: unknown[] }).surfaces)) {
    return (payload as { surfaces: SurfaceDefinition[] }).surfaces;
  }
  return [];
}

function surfaceUrls(payload: unknown) {
  const surfaces = surfaceList(payload);
  const build = (id: string, mode: 'panel' | 'full') => {
    const surface = surfaces.find((item) => item?.id === id);
    const raw = String(surface?.url || surface?.path || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, SPMT_BASE_URL);
      url.searchParams.set('app', 'hearmeout');
      url.searchParams.set('mode', mode);
      if (id === 'overlays') url.searchParams.set('output', 'personal');
      return url.toString();
    } catch {
      return '';
    }
  };
  return {
    worktray: build('worktray', 'panel'),
    overlays: build('overlays', 'full'),
    settings: build('settings', 'full'),
  };
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(HMO_SPMT_COOKIE)?.value || '';
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const [profileResponse, personalResponse, surfacesResponse] = await Promise.all([
    fetch(`${SPMT_BASE_URL}/api/workspace-profile`, { headers, cache: 'no-store' }),
    fetch(`${SPMT_BASE_URL}/api/personal-overlay-launch`, { headers, cache: 'no-store' }),
    fetch(`${SPMT_BASE_URL}/api/platform/surfaces`, { headers, cache: 'no-store' }),
  ]);
  const [payload, personalPayload, surfacesPayload] = await Promise.all([
    profileResponse.json().catch(() => null),
    personalResponse.json().catch(() => null),
    surfacesResponse.json().catch(() => null),
  ]);
  if (!profileResponse.ok || !payload?.profile) {
    return NextResponse.json({ error: payload?.error || 'Workspace theme unavailable' }, { status: profileResponse.status || 502 });
  }

  const tenant = personalResponse.ok ? String(personalPayload?.tenant || '').trim().toLowerCase() : '';
  const personalCanonical = personalResponse.ok && typeof personalPayload?.canonicalUrl === 'string'
    ? personalPayload.canonicalUrl
    : (tenant ? `${SPMT_BASE_URL}/tenant/${encodeURIComponent(tenant)}/personal` : null);

  return NextResponse.json({
    tokens: workspaceThemeTokens(payload.profile, 'hearmeout', null),
    tenant: tenant || null,
    tenantOutputs: tenant ? {
      public: `${SPMT_BASE_URL}/tenant/${encodeURIComponent(tenant)}/public`,
      personal: personalCanonical,
    } : null,
    personalOverlayUrl: personalResponse.ok && typeof personalPayload?.url === 'string' ? personalPayload.url : null,
    surfaceUrls: surfacesResponse.ok ? surfaceUrls(surfacesPayload) : { worktray: '', overlays: '', settings: '' },
    revision: payload.profile.revision,
    updatedAt: payload.profile.updatedAt,
  });
}
