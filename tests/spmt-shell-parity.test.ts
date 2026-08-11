import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const text = readFileSync(resolve(process.cwd(), 'src/components/spmt-workspace-host.tsx'), 'utf8');

test('HearMeOut keeps a persistent three-slot Worktray', () => {
  assert.match(text, /aria-label="SPMT workspace tray"/);
  assert.match(text, /\(\[1, 2, 3\] as const\)/);
  assert.doesNotMatch(text, /if \(hiddenRoute \|\| embedded \|\| !connected\) return null/);
});

test('HearMeOut offers a reconnect path and refreshes shared state', () => {
  assert.match(text, /\/login\?next=/);
  assert.match(text, /Reconnect SPMT workspace/);
  assert.match(text, /window\.setInterval\(\(\) => void refresh\(\), 30_000\)/);
  assert.match(text, /visibilitychange/);
});

test('HearMeOut renders canonical overlay coordinates as percentages', () => {
  assert.match(text, /left: `\$\{Number\(widget\.x \|\| 0\)\}%`/);
  assert.match(text, /top: `\$\{Number\(widget\.y \|\| 0\)\}%`/);
});
