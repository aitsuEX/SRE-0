export interface TableauConfigResult {
  status: 'CONFIGURED' | 'NOT_CONFIGURED';
  serverUrl?: string;
  siteId?: string;
  embedUrl?: string;
  message: string;
}

export function checkTableauIntegration(): TableauConfigResult {
  const serverUrl = (process.env.TABLEAU_SERVER_URL || '').trim();
  const siteId = (process.env.TABLEAU_SITE_ID || '').trim();
  const embedUrl = (process.env.TABLEAU_EMBED_URL || '').trim();

  if (!serverUrl || serverUrl === 'undefined' || serverUrl.includes('placeholder')) {
    return {
      status: 'NOT_CONFIGURED',
      message: 'TABLEAU_SERVER_URL is not configured. Tableau embedded dashboard integration is inactive. No simulated metrics or fake views are generated.',
    };
  }

  return {
    status: 'CONFIGURED',
    serverUrl,
    siteId: siteId || 'default',
    embedUrl: embedUrl || `${serverUrl}/views/IncidentMetrics/Dashboard`,
    message: `Tableau integration configured for server ${serverUrl}`,
  };
}
