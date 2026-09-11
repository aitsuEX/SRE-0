import { INCIDENT_CONFIG, isConfigured } from '@/src/config/incident';
import { loadPhasebookState } from '@/lib/simulator/phasebook';

export interface MonitoringResult {
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN' | 'UNAVAILABLE';
  metrics: Record<string, number | string>;
  checkedAt: string;
  sourceUrl: string;
}

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[\s-_]+/g, '');
}

export async function checkMonitoring(metric?: string): Promise<MonitoringResult> {
  const checkedAt = new Date().toISOString();
  const url = (INCIDENT_CONFIG.monitoringUrl || '').trim();

  if (!url || (!isConfigured(url) && !url.startsWith('/'))) {
    console.log(`[check_monitoring] tool=check_monitoring sourceUrl="${url || 'NONE'}" status=UNKNOWN timestamp=${checkedAt} note="Not configured"`);
    return { status: 'UNKNOWN', metrics: {}, checkedAt, sourceUrl: url || '' };
  }

  try {
    let data: any = null;

    // If pointing to the Phasebook system state endpoint or local API route, evaluate real Phasebook state directly
    if (url.startsWith('/') || url.includes('/api/system') || (url.includes('localhost') && url.includes('/api/'))) {
      data = loadPhasebookState();
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const r = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'SRE-Zero/1.0',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
          },
          cache: 'no-store',
        });
        clearTimeout(timer);
        if (r.ok) {
          data = await r.json();
        } else {
          return { status: 'UNAVAILABLE', metrics: {}, checkedAt, sourceUrl: url };
        }
      } catch (fetchErr) {
        clearTimeout(timer);
        const errorMsg = fetchErr instanceof Error ? fetchErr.message : 'Unknown error';
        console.log(`[check_monitoring] tool=check_monitoring sourceUrl="${url}" status=UNAVAILABLE error="${errorMsg}" timestamp=${checkedAt}`);
        return { status: 'UNAVAILABLE', metrics: {}, checkedAt, sourceUrl: url };
      }
    }

    if (!data || typeof data !== 'object') {
      return { status: 'UNAVAILABLE', metrics: {}, checkedAt, sourceUrl: url };
    }

    // Determine overall monitoring status from real returned data
    const rawStatus = String(data.systemHealth || data.overall || data.status || '').toUpperCase();
    let status: MonitoringResult['status'] = 'UNKNOWN';
    if (['HEALTHY', 'OK', 'UP', 'RUNNING'].includes(rawStatus)) {
      status = 'HEALTHY';
    } else if (['DEGRADED', 'WARN', 'WARNING'].includes(rawStatus)) {
      status = 'DEGRADED';
    } else if (['UNHEALTHY', 'DOWN', 'CRITICAL', 'FAILED', 'ERROR'].includes(rawStatus)) {
      status = 'DOWN';
    }

    // Collect all real metrics without hardcoding
    const allMetrics: Record<string, number | string> = {};

    // 1. Time-series metrics (from currentMetrics or current)
    const cur = data.currentMetrics || data.current;
    if (cur && typeof cur === 'object') {
      if (typeof cur.cpu === 'number') allMetrics['cpu'] = cur.cpu;
      if (typeof cur.memory === 'number') allMetrics['memory'] = cur.memory;
      if (typeof cur.latency === 'number') {
        allMetrics['latency'] = cur.latency;
        allMetrics['latency_ms'] = cur.latency;
      }
      if (typeof cur.errorRate === 'number') {
        allMetrics['error_rate'] = cur.errorRate;
        allMetrics['errorRate'] = cur.errorRate;
      }
      if (typeof cur.requestRate === 'number') {
        allMetrics['request_rate'] = cur.requestRate;
        allMetrics['requestRate'] = cur.requestRate;
      }
      if (typeof cur.http5xxRate === 'number') {
        allMetrics['http_5xx_rate'] = cur.http5xxRate;
        allMetrics['http5xxRate'] = cur.http5xxRate;
        allMetrics['5xx_rate'] = cur.http5xxRate;
      }
      if (typeof cur.dbConnectionErrors === 'number') {
        allMetrics['db_connection_errors'] = cur.dbConnectionErrors;
        allMetrics['dbConnectionErrors'] = cur.dbConnectionErrors;
      }
    }

    // 2. Per-service telemetry (from services map)
    if (data.services && typeof data.services === 'object') {
      for (const [svcName, svc] of Object.entries(data.services as Record<string, any>)) {
        if (svc && typeof svc === 'object') {
          if (svc.status) allMetrics[`${svcName}_status`] = svc.status;
          if (svc.health) allMetrics[`${svcName}_health`] = svc.health;
          if (typeof svc.cpu === 'number') allMetrics[`${svcName}_cpu`] = svc.cpu;
          if (typeof svc.memory === 'number') allMetrics[`${svcName}_memory`] = svc.memory;
          if (typeof svc.latencyMs === 'number') allMetrics[`${svcName}_latency`] = svc.latencyMs;
          if (typeof svc.errorRate === 'number') allMetrics[`${svcName}_error_rate`] = svc.errorRate;
          if (typeof svc.replicas === 'number') allMetrics[`${svcName}_replicas`] = svc.replicas;
        }
      }
    }

    // 3. Overall health label & version
    const overallHealth = data.systemHealth || data.overall || (status !== 'UNKNOWN' ? status : undefined);
    if (overallHealth) {
      allMetrics['service_health'] = overallHealth;
      allMetrics['health'] = overallHealth;
    }

    const version = data.currentVersion || data.version || data.currentDeployment?.version;
    if (version) {
      allMetrics['version'] = version;
      allMetrics['current_version'] = version;
    }

    // 4. Any direct nested metrics object
    if (data.metrics && typeof data.metrics === 'object' && !Array.isArray(data.metrics)) {
      for (const [k, v] of Object.entries(data.metrics)) {
        if (typeof v === 'number' || typeof v === 'string') {
          allMetrics[k] = v;
        }
      }
    }

    // If no specific metric was requested, return all gathered metrics
    if (!metric || !metric.trim()) {
      console.log(`[check_monitoring] tool=check_monitoring sourceUrl="${url}" httpStatus=200 status=${status} metricsCount=${Object.keys(allMetrics).length} keys="${Object.keys(allMetrics).join(',')}" timestamp=${checkedAt}`);
      return { status, metrics: allMetrics, checkedAt, sourceUrl: url };
    }

    // If a specific metric was requested, find it in the real metrics map
    const targetNorm = normalizeKey(metric);
    let matchedKey: string | null = null;

    for (const k of Object.keys(allMetrics)) {
      if (k === metric || normalizeKey(k) === targetNorm) {
        matchedKey = k;
        break;
      }
    }

    // If not found directly, check common aliases
    if (!matchedKey) {
      if (['cpu', 'cpuusage', 'processor'].includes(targetNorm) && 'cpu' in allMetrics) {
        matchedKey = 'cpu';
      } else if (['memory', 'mem', 'ram'].includes(targetNorm) && 'memory' in allMetrics) {
        matchedKey = 'memory';
      } else if (['errorrate', 'errors', 'error', 'errrate'].includes(targetNorm) && 'error_rate' in allMetrics) {
        matchedKey = 'error_rate';
      } else if (['latency', 'responsetime', 'latencyms'].includes(targetNorm) && 'latency' in allMetrics) {
        matchedKey = 'latency';
      } else if (['requestrate', 'requests', 'rps'].includes(targetNorm) && 'request_rate' in allMetrics) {
        matchedKey = 'request_rate';
      } else if (['5xx', '5xxrate', 'http5xx', 'http5xxrate'].includes(targetNorm) && 'http_5xx_rate' in allMetrics) {
        matchedKey = 'http_5xx_rate';
      } else if (['db', 'database', 'dbconnectionerrors', 'dberrors'].includes(targetNorm) && 'db_connection_errors' in allMetrics) {
        matchedKey = 'db_connection_errors';
      } else if (['health', 'servicehealth', 'overallhealth', 'status'].includes(targetNorm) && 'service_health' in allMetrics) {
        matchedKey = 'service_health';
      } else if (['version', 'currentversion'].includes(targetNorm) && 'version' in allMetrics) {
        matchedKey = 'version';
      }
    }

    if (!matchedKey || !(matchedKey in allMetrics)) {
      console.log(`[check_monitoring] tool=check_monitoring sourceUrl="${url}" httpStatus=200 status=UNKNOWN requestedMetric="${metric}" timestamp=${checkedAt}`);
      return { status: 'UNKNOWN', metrics: {}, checkedAt, sourceUrl: url };
    }

    const matchedMetrics = { [matchedKey]: allMetrics[matchedKey] };
    console.log(`[check_monitoring] tool=check_monitoring sourceUrl="${url}" httpStatus=200 status=${status} matchedMetric="${matchedKey}" value="${allMetrics[matchedKey]}" timestamp=${checkedAt}`);
    return {
      status,
      metrics: matchedMetrics,
      checkedAt,
      sourceUrl: url,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.log(`[check_monitoring] tool=check_monitoring sourceUrl="${url}" status=UNAVAILABLE error="${errorMsg}" timestamp=${checkedAt}`);
    return { status: 'UNAVAILABLE', metrics: {}, checkedAt, sourceUrl: url };
  }
}