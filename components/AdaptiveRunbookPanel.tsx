'use client';

import { useState, useEffect, useCallback } from 'react';
import { BookOpen, CheckCircle2, Clock, ShieldAlert, HelpCircle } from 'lucide-react';
import type { RunbookExecutionState, RunbookStepStatus } from '@/lib/runbook/types';

export function AdaptiveRunbookPanel({ channel }: { channel: string }) {
  const [runbookState, setRunbookState] = useState<RunbookExecutionState | null>(null);

  const fetchRunbook = useCallback(async () => {
    try {
      const res = await fetch(`/api/mcp?channel=${encodeURIComponent(channel)}`);
      if (res.ok) {
        const data = await res.json();
        // Generate dynamic runbook execution state from state evidence
        const hasWeb = data.evidence?.some((e: any) => e.source === 'WEBSITE');
        const hasMon = data.evidence?.some((e: any) => e.source === 'MONITORING');
        const hasGit = data.evidence?.some((e: any) => e.source === 'GITHUB');
        const isRecovered = data.recovery?.state === 'RECOVERED';
        const isVerifying = data.recovery?.state === 'VERIFYING_RECOVERY';

        const steps = [
          { id: 'step-1', name: 'Check Website Status', type: 'investigation', action: 'checkWebsite', status: hasWeb ? 'COMPLETED' : 'IN_PROGRESS' },
          { id: 'step-2', name: 'Fetch Telemetry Metrics', type: 'investigation', action: 'checkMonitoring', status: hasMon ? 'COMPLETED' : hasWeb ? 'IN_PROGRESS' : 'PENDING' },
          { id: 'step-3', name: 'Inspect GitHub Deployments', type: 'investigation', action: 'checkGitHub', status: hasGit ? 'COMPLETED' : hasMon ? 'IN_PROGRESS' : 'PENDING' },
          { id: 'step-4', name: 'Human Remediation Decision', type: 'human_decision', action: 'askHuman', status: isRecovered || isVerifying ? 'COMPLETED' : 'IN_PROGRESS' },
          { id: 'step-5', name: 'Verify Independent Recovery', type: 'verification', action: 'verifyRecovery', status: isRecovered ? 'COMPLETED' : isVerifying ? 'IN_PROGRESS' : 'PENDING' },
        ];

        setRunbookState({
          runbookId: 'runbook-payment-api',
          runbookName: 'Payment API High Error Rate Runbook',
          activeStepId: steps.find((s) => s.status === 'IN_PROGRESS')?.id || 'step-1',
          overallStatus: isRecovered ? 'COMPLETED' : 'IN_PROGRESS',
          steps: steps as any,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          aiExplanation: {
            activeStepName: steps.find((s) => s.status === 'IN_PROGRESS')?.name || 'All Steps Completed',
            whyPerformed: 'Automated evidence-driven operational procedure executing sequentially.',
            requiredEvidence: 'Real HTTP status, monitoring telemetry, and human verification.',
            remainingStepsCount: steps.filter((s) => s.status === 'PENDING' || s.status === 'IN_PROGRESS').length,
          },
        });
      }
    } catch (e) {
      console.error('Failed to fetch runbook state:', e);
    }
  }, [channel]);

  useEffect(() => {
    fetchRunbook();
    const interval = setInterval(fetchRunbook, 4000);
    return () => clearInterval(interval);
  }, [fetchRunbook]);

  const getStatusBadge = (status: RunbookStepStatus) => {
    switch (status) {
      case 'COMPLETED':
        return <span className="bg-success/20 text-success-foreground px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> COMPLETED</span>;
      case 'IN_PROGRESS':
        return <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1"><Clock className="w-3 h-3 animate-spin" /> IN_PROGRESS</span>;
      case 'BLOCKED':
        return <span className="bg-destructive/20 text-destructive px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> BLOCKED</span>;
      case 'SKIPPED':
        return <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded text-[11px] font-semibold">SKIPPED</span>;
      case 'FAILED':
        return <span className="bg-destructive text-white px-2 py-0.5 rounded text-[11px] font-semibold">FAILED</span>;
      default:
        return <span className="bg-muted/50 text-muted-foreground px-2 py-0.5 rounded text-[11px]">PENDING</span>;
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-lg space-y-5">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
          <BookOpen className="w-5 h-5 text-primary" /> Adaptive Operational Runbook
        </h3>
        <span className="text-xs font-mono bg-muted px-2.5 py-1 rounded text-muted-foreground">
          {runbookState?.runbookName || 'Loading Runbook...'}
        </span>
      </div>

      {/* Steps Pipeline Visualizer */}
      <div className="space-y-3">
        {runbookState?.steps.map((step, idx) => (
          <div
            key={step.id}
            className={`p-3.5 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
              step.status === 'IN_PROGRESS'
                ? 'bg-primary/10 border-primary/50 shadow-md'
                : step.status === 'COMPLETED'
                ? 'bg-success/5 border-success/30'
                : 'bg-background/40 border-border/60'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-muted-foreground">Step {idx + 1}:</span>
                <span className="font-semibold text-foreground text-sm">{step.name}</span>
                <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                  {step.type}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">{step.description}</p>
            </div>
            <div>{getStatusBadge(step.status)}</div>
          </div>
        ))}
      </div>

      {/* AI Runbook Reasoning & Guidance Component */}
      {runbookState?.aiExplanation && (
        <div className="bg-background/70 border border-primary/30 rounded-lg p-4 space-y-2 text-xs">
          <h4 className="font-semibold text-primary flex items-center gap-1.5">
            <HelpCircle className="w-4 h-4" /> AI Runbook Reasoning Engine:
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-muted-foreground">
            <div>
              <strong className="text-foreground">Active Step:</strong> {runbookState.aiExplanation.activeStepName}
            </div>
            <div>
              <strong className="text-foreground">Remaining Steps:</strong> {runbookState.aiExplanation.remainingStepsCount}
            </div>
            <div className="col-span-1 sm:col-span-2">
              <strong className="text-foreground">Step Requirement:</strong> {runbookState.aiExplanation.requiredEvidence}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
