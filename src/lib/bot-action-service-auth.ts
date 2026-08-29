import { timingSafeEqual } from 'node:crypto';

function configuredSecrets(): string[] {
  return Array.from(new Set([
    process.env.HEARMEOUT_SERVICE_SECRET,
    process.env.STREAMWEAVER_SECRET,
    process.env.BOT_SECRET_KEY,
  ].map((value) => String(value || '').trim()).filter(Boolean)));
}

function equal(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isBotActionServiceRequest(request: Request): boolean {
  const authorization = String(request.headers.get('authorization') || '');
  if (!authorization.startsWith('Bearer ')) return false;
  const supplied = authorization.slice(7).trim();
  return !!supplied && configuredSecrets().some((secret) => equal(supplied, secret));
}
