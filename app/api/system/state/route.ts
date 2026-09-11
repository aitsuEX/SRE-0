import { NextRequest, NextResponse } from 'next/server';
import { loadPhasebookState, rollbackPhasebook, injectPhasebookFailure } from '@/lib/simulator/phasebook';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = loadPhasebookState();
  return NextResponse.json(state, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === 'rollback' || body.databaseFailure === false) {
      const state = rollbackPhasebook();
      return NextResponse.json({ ok: true, action: 'rollback', state });
    }
    if (body.action === 'fail' || body.action === 'inject' || body.databaseFailure === true) {
      const state = injectPhasebookFailure(body.failureType || '5XX_SPIKE');
      return NextResponse.json({ ok: true, action: 'inject', state });
    }
    const state = loadPhasebookState();
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
