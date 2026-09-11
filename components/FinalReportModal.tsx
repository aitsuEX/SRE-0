'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText, Copy, Download, X, Check } from 'lucide-react';
import type { IncidentReportsBundle } from '@/lib/reports/generator';

export function FinalReportModal({ channel, isOpen, onClose }: { channel: string; isOpen: boolean; onClose: () => void }) {
  const [reports, setReports] = useState<IncidentReportsBundle | null>(null);
  const [activeTab, setActiveTab] = useState<'COMBINED' | 'INTELLIGENCE' | 'CONVERSATION'>('COMBINED');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports?channel=${encodeURIComponent(channel)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.reports) setReports(data.reports);
      }
    } catch (e) {
      console.error('Failed to fetch reports:', e);
    } finally {
      setLoading(false);
    }
  }, [channel]);

  useEffect(() => {
    if (isOpen) fetchReports();
  }, [isOpen, fetchReports]);

  if (!isOpen) return null;

  const currentText =
    activeTab === 'COMBINED'
      ? reports?.combinedReport || ''
      : activeTab === 'INTELLIGENCE'
      ? reports?.intelligenceReport || ''
      : reports?.conversationReport || '';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(currentText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadReport = () => {
    const element = document.createElement('a');
    const file = new Blob([currentText], { type: 'text/markdown' });
    element.href = URL.createObjectURL(file);
    element.download = `SRE-Zero_Report_${channel}_${activeTab.toLowerCase()}.md`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <h3 className="text-base font-bold text-foreground">SRE-Zero Complete Incident Reports</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Report Layer Switcher */}
        <div className="flex items-center justify-between border-b border-border bg-muted/20 px-4 py-2 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('COMBINED')}
              className={`px-3 py-1.5 rounded font-semibold transition ${
                activeTab === 'COMBINED' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Combined Final Report
            </button>
            <button
              onClick={() => setActiveTab('INTELLIGENCE')}
              className={`px-3 py-1.5 rounded font-semibold transition ${
                activeTab === 'INTELLIGENCE' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Incident Intelligence Layer
            </button>
            <button
              onClick={() => setActiveTab('CONVERSATION')}
              className={`px-3 py-1.5 rounded font-semibold transition ${
                activeTab === 'CONVERSATION' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Conversation Report Layer
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={copyToClipboard}
              className="bg-secondary text-secondary-foreground px-3 py-1.5 rounded font-semibold flex items-center gap-1 hover:bg-secondary/80 transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy Markdown'}
            </button>
            <button
              onClick={downloadReport}
              className="bg-primary text-primary-foreground px-3 py-1.5 rounded font-semibold flex items-center gap-1 hover:bg-primary/90 transition"
            >
              <Download className="w-3.5 h-3.5" /> Download .md
            </button>
          </div>
        </div>

        {/* Report Markdown Viewer */}
        <div className="flex-1 overflow-y-auto p-5 font-mono text-xs text-foreground bg-background space-y-2 whitespace-pre-wrap">
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Generating production incident reports...</div>
          ) : (
            currentText
          )}
        </div>
      </div>
    </div>
  );
}
