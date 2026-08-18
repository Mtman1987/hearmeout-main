import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const text = readFileSync(resolve(process.cwd(), 'src/components/spmt-workspace-host.tsx'), 'utf8');
const personal = readFileSync(resolve(process.cwd(), 'src/components/personal-overlay-host.tsx'), 'utf8');
const theme = readFileSync(resolve(process.cwd(), 'src/app/api/spmt/workspace-theme/route.ts'), 'utf8');
const layout = readFileSync(resolve(process.cwd(), 'src/app/layout.tsx'), 'utf8');
const sidebar = readFileSync(resolve(process.cwd(), 'src/app/components/LeftSidebar.tsx'), 'utf8');
const parityCss = readFileSync(resolve(process.cwd(), 'src/app/workspace-parity.css'), 'utf8');

test('HearMeOut collapses Workspace fully into the ecosystem header', () => {
  assert.match(text, /spmt:workspace-toggle/);
  assert.match(text, /spmt:workspace-open-app/);
  assert.match(text, /spmt:workspace-state/);
  assert.match(text, /if \(!open\) return null/);
  assert.match(text, /\(\[1, 2, 3\] as const\)/);
  assert.doesNotMatch(text, /data-workspace-footer="true"/);
  assert.doesNotMatch(text, /workspace-footer-visible/);
  assert.doesNotMatch(text, /event\.altKey && event\.shiftKey/);
});

test('HearMeOut keeps dashboard, room, and settings sticky chrome below the shared ecosystem header', () => {
  assert.match(parityCss, /\[data-workspace-topbar\],[\s\S]*header\.sticky[\s\S]*top:\s*var\(--spmt-ecosystem-header-height,\s*40px\)\s*!important/);
});

test('HearMeOut persists header-opened apps into canonical Workspace slots', () => {
  assert.match(text, /method: 'PATCH'/);
  assert.match(text, /slotId: targetSlot\.id/);
  assert.match(theme, /export async function PATCH/);
  assert.match(theme, /api\/workspace-profile/);
  assert.match(theme, /If-Match/);
  assert.match(theme, /target\.collapsed = false/);
});

test('HearMeOut offers a reconnect path and refreshes shared state', () => {
  assert.match(text, /\/api\/auth\/spmt\/login\?next=/);
  assert.match(text, /Reconnect SPMT workspace/);
  assert.match(text, /window\.setInterval\(\(\) => void refresh\(\), 30_000\)/);
  assert.match(text, /visibilitychange/);
});

test('HearMeOut uses one canonical Personal renderer instead of rebuilding widgets', () => {
  assert.equal((layout.match(/<PersonalOverlayHost \/>/g) || []).length, 1);
  assert.match(personal, /data-canonical-personal-overlay="true"/);
  assert.match(personal, /PERSONAL_VISIBILITY_EVENT/);
  assert.doesNotMatch(text, /widgets\.map\(/);
  assert.doesNotMatch(text, /widget\.x|widget\.y|widget\.opacity/);
  assert.match(text, /Personal overlay \{personalOverlayVisible \? 'On' : 'Off'\}/);
  assert.match(text, /Copy Public URL/);
  assert.match(text, /Copy Personal URL/);
});

test('HearMeOut uses the SPMT signed launch URL while exposing clean canonical copy URLs', () => {
  assert.match(theme, /api\/personal-overlay-launch/);
  assert.match(theme, /tenantOutputs: tenant \? \{/);
  assert.match(theme, /public: `\$\{SPMT_BASE_URL\}\/tenant\/\$\{encodeURIComponent\(tenant\)\}\/public`/);
  assert.match(theme, /personal: personalCanonical/);
  assert.doesNotMatch(theme, /access_token=|spmt_token=/i);
});

test('HearMeOut custom sidebar content collapses into the icon rail cleanly', () => {
  assert.match(sidebar, /<Sidebar collapsible="icon" data-workspace-sidebar>/);
  assert.match(sidebar, /<SidebarRail \/>/);
  assert.match(sidebar, /DSHLiveUsers[\s\S]*group-data-\[collapsible=icon\]:hidden/);
  assert.match(sidebar, /HMOOnlineUsers[\s\S]*group-data-\[collapsible=icon\]:hidden/);
  assert.match(sidebar, /CreateRoomDialog[\s\S]*group-data-\[collapsible=icon\]:hidden/);
  assert.match(sidebar, /group-data-\[collapsible=icon\]:flex-col/);
});
