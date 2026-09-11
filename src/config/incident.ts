import { getActiveWebsiteUrl, setActiveWebsiteTarget, resetWebsiteTarget, normalizeUrl } from '@/lib/runtime-website-target';

export { normalizeUrl, getActiveWebsiteUrl, setActiveWebsiteTarget, resetWebsiteTarget };

export function validUrl(value?: string): boolean {
  if (!value) return false;
  if (value.startsWith('/')) return true;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export const INCIDENT_CONFIG = {
  get incidentId() { return process.env.INCIDENT_ID || ''; },
  get incidentName() { return process.env.INCIDENT_NAME || 'Active Incident'; },
  get severity() { return process.env.INCIDENT_SEVERITY || 'UNKNOWN'; },
  get description() { return process.env.INCIDENT_DESCRIPTION || ''; },
  get websiteUrl() { return getActiveWebsiteUrl(); },
  get githubRepoUrl() { return normalizeUrl(process.env.INCIDENT_GITHUB_REPO_URL); },
  get jiraUrl() { return normalizeUrl(process.env.INCIDENT_JIRA_URL); },
  get jiraProjectKey() { return (process.env.INCIDENT_JIRA_PROJECT_KEY || '').trim().toUpperCase(); },
  get jiraEmail() { return (process.env.INCIDENT_JIRA_EMAIL || '').trim(); },
  get monitoringUrl() { return normalizeUrl(process.env.INCIDENT_MONITORING_URL); },
  get githubBranch() { return process.env.INCIDENT_GITHUB_BRANCH || 'main'; },
  get monitoringService() { return process.env.INCIDENT_MONITORING_SERVICE || ''; },
  get allowDestructiveActions() { return process.env.SRE_ZERO_ALLOW_DESTRUCTIVE_ACTIONS === 'true'; },
  get pagerDutyApiToken() { return (process.env.PAGERDUTY_API_TOKEN || '').trim(); },
  get pagerDutyServiceId() { return (process.env.PAGERDUTY_SERVICE_ID || '').trim(); },
  get pagerDutyApiBase() { return (process.env.PAGERDUTY_API_BASE_URL || 'https://api.pagerduty.com').trim().replace(/\/$/, ''); },
};

export type IncidentConfig = typeof INCIDENT_CONFIG;
export function isConfigured(url: string | undefined) {
  return validUrl(url);
}
export function getIncidentConfig() {
  return { ...INCIDENT_CONFIG };
}
export function isSourceConfigured(
  source: keyof Pick<IncidentConfig, 'websiteUrl' | 'githubRepoUrl' | 'jiraUrl' | 'monitoringUrl'>
) {
  return isConfigured(INCIDENT_CONFIG[source]);
}
export function isPagerDutyConfigured() {
  return Boolean(INCIDENT_CONFIG.pagerDutyApiToken && INCIDENT_CONFIG.pagerDutyServiceId);
}