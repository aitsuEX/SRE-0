import fs from 'fs';
import path from 'path';
import os from 'os';

export function normalizeUrl(value?: string): string {
  return (value || '').trim().replace(/\/$/, '');
}

/**
 * Single primary incident target reader.
 * Reads INCIDENT_WEBSITE_URL from process.env or local env files.
 * Returns empty string if unconfigured (no hardcoded fake fallbacks).
 */
export function getActiveWebsiteUrl(): string {
  if (process.env.INCIDENT_WEBSITE_URL) {
    return normalizeUrl(process.env.INCIDENT_WEBSITE_URL);
  }

  const candidateEnvPaths = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
  ];

  for (const envPath of candidateEnvPaths) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ envPath)) {
        const envFileContent = fs.readFileSync(/*turbopackIgnore: true*/ envPath, 'utf-8');
        const match = envFileContent.match(/^\s*INCIDENT_WEBSITE_URL\s*=\s*(.+)$/m);
        if (match && match[1]) {
          return normalizeUrl(match[1].trim().replace(/^['"](.*)['"]$/, '$1'));
        }
      }
    } catch {}
  }

  return '';
}

export function getRuntimeTargetDiagnostic() {
  const websiteUrl = getActiveWebsiteUrl();
  return {
    processPid: process.pid,
    hostname: os.hostname(),
    mcpServerUrl: process.env.MCP_SERVER_URL || '',
    activeTarget: 'incident',
    activeUrl: websiteUrl || 'UNCONFIGURED',
    incidentUrl: websiteUrl || 'UNCONFIGURED',
    lastUpdatedAt: new Date().toISOString(),
  };
}

// Deprecated stubs for backwards compatibility with test scripts
export function resetWebsiteTarget(): void {}
export function setActiveWebsiteTarget(_target: string, _switchedBy?: string): void {}
