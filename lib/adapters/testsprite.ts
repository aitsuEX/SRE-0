import { isConfigured } from '@/src/config/incident';
export interface TestSpriteResult { testRunId?: string; status:'PASS'|'FAIL'|'PARTIAL'|'UNKNOWN'|'UNAVAILABLE'; tests:Array<{name:string;status:'PASS'|'FAIL'|'SKIPPED'|'UNKNOWN';durationMs?:number;error?:string}>; startedAt?:string; completedAt?:string; sourceUrl:string; }
export async function checkTestSprite(url = ''): Promise<TestSpriteResult> {
  const sourceUrl = url || '';
  if (!isConfigured(url)) return { status: 'UNAVAILABLE', tests: [], sourceUrl };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'SRE-Zero/1.0' } });
    clearTimeout(timer);
    if (!r.ok) return { status: 'UNAVAILABLE', tests: [], sourceUrl };
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) return { status: 'UNKNOWN', tests: [], sourceUrl };
    const data = await r.json() as any;
    const raw = Array.isArray(data.tests) ? data.tests : Array.isArray(data.results) ? data.results : Array.isArray(data.test_results) ? data.test_results : [];
    const tests = raw.map((t: any) => {
      const s = String(t.status || t.result || '').toUpperCase();
      return {
        name: String(t.name || t.test_name || t.title || 'unknown'),
        status: s === 'PASS' || s === 'PASSED' ? 'PASS' : s === 'FAIL' || s === 'FAILED' || s === 'ERROR' ? 'FAIL' : s === 'SKIPPED' ? 'SKIPPED' : 'UNKNOWN',
        durationMs: t.durationMs,
        error: t.error || t.message,
      };
    });
    const passed = tests.filter((t: { status: string }) => t.status === 'PASS').length;
    const failed = tests.filter((t: { status: string }) => t.status === 'FAIL').length;
    return {
      status: failed && passed ? 'PARTIAL' : failed ? 'FAIL' : passed ? 'PASS' : 'UNKNOWN',
      tests,
      testRunId: data.testRunId || data.id,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      sourceUrl,
    };
  } catch (error) {
    clearTimeout(timer);
    return { status: error instanceof Error && error.name === 'AbortError' ? 'UNKNOWN' : 'UNAVAILABLE', tests: [], sourceUrl };
  }
}

