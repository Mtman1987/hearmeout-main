import { NextResponse } from 'next/server';

export async function GET() {
  const requiredSecretNames = ['JWT_SECRET', 'HEARMEOUT_CLIENT_SECRET', 'SPMT_API_KEY'];
  const missingSecretNames = process.env.NODE_ENV === 'production'
    ? requiredSecretNames.filter((name) => !String(process.env[name] || '').trim())
    : [];
  return NextResponse.json({
    status: missingSecretNames.length ? 'not-ready' : 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    dependencies: {
      serviceCredentials: missingSecretNames.length
        ? { status: 'unavailable', missingSecretNames }
        : { status: 'configured' },
    },
  }, { status: missingSecretNames.length ? 503 : 200 });
}
