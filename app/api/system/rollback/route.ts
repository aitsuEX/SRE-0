import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: 'AUTOMATED_ROLLBACK_DISABLED',
      message:
        'Automated rollback endpoints are disabled by architecture. AI can recommend options, but humans must perform all system/code modifications. SRE-Zero will independently verify system recovery after a human reports the change.',
    },
    { status: 403 }
  );
}

