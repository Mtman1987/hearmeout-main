import { db } from '@/lib/db';

type CoderJob = {
  id?: string;
  status?: string;
  appName?: string;
  repoId?: string;
  description?: string;
  summary?: string;
  changedFiles?: string[];
  checks?: Array<{ command?: string; ok?: boolean; output?: string }>;
  pullRequest?: { number?: number; url?: string; branch?: string; commit?: string };
};

type CoderControlResponse = {
  ok?: boolean;
  action?: string;
  message?: string;
  job?: CoderJob;
  jobs?: CoderJob[];
  content?: string;
  artifact?: string;
  pullRequest?: CoderJob['pullRequest'];
  confirmation?: { type?: string; jobId?: string; expiresInSeconds?: number };
  error?: string;
};

type ControlState = {
  lastJobId?: string;
  pendingPublish?: { jobId: string; expiresAt: number } | null;
  updatedAt?: string;
};

const ROTATOR_BASE_URL = String(
  process.env.ROTATOR_BASE_URL || process.env.MOUNTAINVIEW_BASE_URL || 'https://mtman-machine-rotator.fly.dev',
).replace(/\/$/, '');

function clean(value: unknown, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function explicitJobId(text: string) {
  return text.match(/\bmtfix_[a-zA-Z0-9_-]+\b/)?.[0] || '';
}

function stateKey(userId: string, roomId?: string) {
  return clean(roomId, 160) || `private-athena:${clean(userId, 160)}`;
}

function readState(key: string): ControlState {
  const state = db.get('privateAthenaControl', key);
  return state && typeof state === 'object' ? state as ControlState : {};
}

function writeState(key: string, patch: Partial<ControlState>) {
  const current = readState(key);
  db.set('privateAthenaControl', key, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function looksLikeCoderRequest(text: string) {
  return /\b(?:fix|repair|patch|code|coder|repo|repository|pull request|\bpr\b|diff|checks?|build|typecheck|tests?|deploy|github|branch|commit)\b/i.test(text)
    && /\b(?:spmt|streamweaver|hear\s*me\s*out|hearmeout|discord|dsh|chat[- ]?tag|mountainview|rotator|athena|bot|app|site|service|code|repo|repository|pull request|\bpr\b)\b/i.test(text);
}

function inferAppName(text: string) {
  const lower = text.toLowerCase();
  if (/hear\s*me\s*out|hearmeout/.test(lower)) return 'hearmeout-main';
  if (/streamweaver/.test(lower)) return 'streamweaver-new';
  if (/discord stream|\bdsh\b|discordstreamhub/.test(lower)) return 'discord-stream-hub-new';
  if (/chat[- ]?tag/.test(lower)) return 'chat-tag-new';
  if (/mountainview|rotator/.test(lower)) return 'mtman-machine-rotator';
  if (/\bspmt\b|spmt\.live|spacemountain\.live/.test(lower)) return 'spmt-live';
  return '';
}

async function callRotator(accessToken: string, body: Record<string, unknown>): Promise<CoderControlResponse> {
  const response = await fetch(`${ROTATOR_BASE_URL}/api/athena/control`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as CoderControlResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(clean(payload.error || `Rotator Athena control returned ${response.status}`, 1000));
  }
  return payload;
}

function summarizeJob(job?: CoderJob) {
  if (!job?.id) return 'I could not find that Athena Coder job.';
  const checks = Array.isArray(job.checks) ? job.checks : [];
  const passed = checks.filter((item) => item.ok).length;
  const files = Array.isArray(job.changedFiles) ? job.changedFiles : [];
  const pr = job.pullRequest?.url ? ` Draft PR #${job.pullRequest.number || ''} is ready at ${job.pullRequest.url}.` : '';
  const summary = clean(job.summary || '', 1200);
  return `Coder job ${job.id} is ${job.status || 'unknown'} for ${job.appName || job.repoId || 'the repository'}. ${files.length} changed file${files.length === 1 ? '' : 's'}; ${passed}/${checks.length} checks passing.${summary ? ` ${summary}` : ''}${pr}`.trim();
}

export async function maybeHandlePrivateAthenaCoder(input: {
  userId: string;
  roomId?: string;
  text: string;
  accessToken: string;
}): Promise<{ handled: boolean; reply?: string; result?: CoderControlResponse }> {
  const text = clean(input.text, 5000);
  const userId = clean(input.userId, 160);
  if (!text || !userId || !input.accessToken) return { handled: false };

  const key = stateKey(userId, input.roomId);
  const state = readState(key);
  const pending = state.pendingPublish;
  if (pending && pending.expiresAt <= Date.now()) writeState(key, { pendingPublish: null });

  const confirm = /^(?:yes|confirm|confirmed|do it|publish it|make the pr|create the pr|create it|go ahead)(?:\s+mtfix_[a-zA-Z0-9_-]+)?[.! ]*$/i.test(text);
  if (pending && pending.expiresAt > Date.now() && confirm) {
    const result = await callRotator(input.accessToken, { action: 'publish', jobId: pending.jobId, confirmed: true });
    writeState(key, { lastJobId: pending.jobId, pendingPublish: null });
    const url = result.pullRequest?.url || result.job?.pullRequest?.url || '';
    return { handled: true, result, reply: url ? `Draft pull request created: ${url}. I did not merge or deploy it.` : 'Draft pull request created. I did not merge or deploy it.' };
  }

  const mentionedJobId = explicitJobId(text);
  const jobId = mentionedJobId || clean(state.lastJobId, 120);

  if (/\b(?:list|show|what(?:'s| is)? running|recent)\b.*\b(?:coder|jobs?|repairs?)\b/i.test(text)) {
    const result = await callRotator(input.accessToken, { action: 'list' });
    const jobs = result.jobs || [];
    if (jobs[0]?.id) writeState(key, { lastJobId: jobs[0].id });
    const reply = jobs.length
      ? jobs.slice(0, 5).map((job) => summarizeJob(job)).join('\n')
      : 'There are no recent Athena Coder jobs.';
    return { handled: true, result, reply };
  }

  const asksStatus = /\b(?:status|progress|how(?:'s| is)|what happened|result|that fix|that repair|the fix|the repair)\b/i.test(text);
  if (jobId && asksStatus) {
    const result = await callRotator(input.accessToken, { action: 'status', jobId });
    writeState(key, { lastJobId: jobId });
    return { handled: true, result, reply: summarizeJob(result.job) };
  }

  if (jobId && /\b(?:diff|changes|changed files|what did you change|show me the patch)\b/i.test(text)) {
    const result = await callRotator(input.accessToken, { action: 'artifact', jobId, artifact: 'diff' });
    writeState(key, { lastJobId: jobId });
    return { handled: true, result, reply: `Here is the saved diff for ${jobId}:\n${clean(result.content, 7000)}` };
  }

  if (jobId && /\b(?:checks?|tests?|validation|typecheck|build results?)\b/i.test(text)) {
    const result = await callRotator(input.accessToken, { action: 'artifact', jobId, artifact: 'checks' });
    writeState(key, { lastJobId: jobId });
    return { handled: true, result, reply: `Validation for ${jobId}:\n${clean(result.content, 7000)}` };
  }

  if (jobId && /\b(?:publish|pull request|\bpr\b)\b/i.test(text)) {
    const result = await callRotator(input.accessToken, { action: 'publish', jobId, confirmed: false });
    writeState(key, { lastJobId: jobId, pendingPublish: { jobId, expiresAt: Date.now() + 5 * 60_000 } });
    return {
      handled: true,
      result,
      reply: result.message || `Job ${jobId} is ready for draft-PR publication. Say “confirm” within five minutes to create the draft PR. I will not merge or deploy it.`,
    };
  }

  if (!looksLikeCoderRequest(text)) return { handled: false };

  const appName = inferAppName(text);
  const description = text
    .replace(/^\s*(?:hey\s+)?(?:athena|annie)[,:]?\s*/i, '')
    .replace(/^\s*(?:please\s+)?(?:use\s+)?(?:coder\s+to\s+)?/i, '')
    .trim();
  const result = await callRotator(input.accessToken, {
    action: 'create',
    appName: appName || undefined,
    description,
    source: 'hearmeout-private-athena',
    reporterId: userId,
  });
  const created = result.job;
  if (created?.id) writeState(key, { lastJobId: created.id, pendingPublish: null });
  return {
    handled: true,
    result,
    reply: created?.id
      ? `I queued Athena Coder job ${created.id} for ${created.appName || created.repoId || 'the matching repository'}. This private Athena control surface will remember that job across reconnects; ask me for its status, diff, checks, or say “publish it” when it is validated.`
      : (result.message || 'I queued the Athena Coder job.'),
  };
}
