import { NextResponse } from 'next/server';
import { loadPhasebookState } from '@/lib/simulator/phasebook';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = loadPhasebookState();
  const isHealthy = state.systemHealth === 'HEALTHY' && !state.databaseFailure && state.activeFailureType === 'NONE';

  if (!isHealthy) {
    return NextResponse.json(
      {
        status: 'DOWN',
        httpStatus: 500,
        service: 'Phasebook Edge Gateway',
        version: state.currentVersion,
        error: '500 Internal Server Error - Elevated 5xx error rate and service degradation',
        metrics: state.currentMetrics,
        checkedAt: new Date().toISOString(),
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      },
    );
  }

  return NextResponse.json(
    {
      status: 'UP',
      httpStatus: 200,
      service: 'Phasebook Edge Gateway',
      version: state.currentVersion,
      message: '200 OK - Phasebook Edge Gateway Healthy',
      metrics: state.currentMetrics,
      checkedAt: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    },
  );
}
