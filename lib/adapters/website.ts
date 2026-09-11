import { isConfigured, INCIDENT_CONFIG, getActiveWebsiteUrl } from '@/src/config/incident';
import { getRuntimeTargetDiagnostic } from '@/lib/runtime-website-target';

export interface WebsiteCheckResult {
  status: 'UP' | 'DOWN' | 'TIMEOUT' | 'UNAVAILABLE' | 'UNKNOWN';
  httpStatus?: number;
  responseTimeMs?: number;
  checkedAt: string;
  sourceUrl: string;
  error?: string;
}

export async function checkWebsite(rawUrl?: string): Promise<WebsiteCheckResult> {
  const checkedAt = new Date().toISOString();
  const diag = getRuntimeTargetDiagnostic();
  const url = (rawUrl || getActiveWebsiteUrl() || INCIDENT_CONFIG.websiteUrl || '').trim();

  if (!url || (!isConfigured(url) && !url.startsWith('/'))) {
    console.log(
      `[checkWebsite] ` +
      JSON.stringify({
        pid: diag.processPid,
        hostname: diag.hostname,
        mcpServerUrl: diag.mcpServerUrl,
        activeTarget: diag.activeTarget,
        activeUrl: url || 'NONE',
        timestamp: checkedAt,
        status: 'UNKNOWN',
        note: 'Website URL is not configured',
      })
    );
    return {
      status: 'UNKNOWN',
      checkedAt,
      sourceUrl: url || '',
      error: 'Website URL is not configured.',
    };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const fetchUrl = url.startsWith('/') ? `http://localhost:${process.env.PORT || '3002'}${url}` : url;
    const response = await fetch(fetchUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'SRE-Zero/1.0',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
    });
    clearTimeout(timer);
    const responseTimeMs = Date.now() - start;
    const httpStatus = response.status;
    const status = response.ok ? 'UP' : response.status >= 500 ? 'DOWN' : 'UNKNOWN';

    const result: WebsiteCheckResult = {
      status,
      httpStatus,
      responseTimeMs,
      checkedAt,
      sourceUrl: url,
    };

    console.log(
      `[checkWebsite] ` +
      JSON.stringify({
        pid: diag.processPid,
        hostname: diag.hostname,
        mcpServerUrl: diag.mcpServerUrl,
        activeTarget: diag.activeTarget,
        activeUrl: url,
        resolvedUrl: fetchUrl,
        timestamp: checkedAt,
        httpStatus,
        status,
        responseTimeMs,
      })
    );

    return result;
  } catch (error) {
    clearTimeout(timer);
    const timeout = error instanceof Error && error.name === 'AbortError';
    const status = timeout ? 'TIMEOUT' : 'UNAVAILABLE';
    const responseTimeMs = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    console.log(
      `[checkWebsite] ` +
      JSON.stringify({
        pid: diag.processPid,
        hostname: diag.hostname,
        mcpServerUrl: diag.mcpServerUrl,
        activeTarget: diag.activeTarget,
        activeUrl: url,
        timestamp: checkedAt,
        status,
        responseTimeMs,
        error: errorMsg,
      })
    );

    return {
      status,
      checkedAt,
      sourceUrl: url,
      responseTimeMs,
      error: errorMsg,
    };
  }
}
