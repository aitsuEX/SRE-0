'use client';

import { useState, useEffect, useCallback } from 'react';
import { History, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import type { TimeMachineSnapshotRecord } from '@/lib/db/repository';

export function IncidentTimeMachine({ channel }: { channel: string }) {
  const [history, setHistory] = useState<TimeMachineSnapshotRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const fetchTimeMachine = useCallback(async () => {
    try {
      const res = await fetch(`/api/time-machine?channel=${encodeURIComponent(channel)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.history) {
          setHistory(data.history);
          if (data.history.length > 0 && selectedIndex === 0) {
            setSelectedIndex(data.history.length - 1);
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch time machine history:', e);
    }
  }, [channel, selectedIndex]);

  useEffect(() => {
    fetchTimeMachine();
    const interval = setInterval(fetchTimeMachine, 5000);
    return () => clearInterval(interval);
  }, [fetchTimeMachine]);

  const activeSnapshot = history[selectedIndex] || null;

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-lg space-y-5">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
            <History className="w-5 h-5 text-primary" /> Incident Time Machine
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Replay and inspect historical state evolution over time without rewriting past hypotheses.
          </p>
        </div>
        <span className="font-mono text-xs bg-muted px-2.5 py-1 rounded text-muted-foreground">
          {history.length} Checkpoints Captured
        </span>
      </div>

      {history.length === 0 ? (
        <div className="text-center py-8 text-xs text-muted-foreground font-mono">
          No historical state checkpoints captured yet. Checkpoints record automatically as incident facts and evidence evolve.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Timeline Scrubber Slider */}
          <div className="bg-background/60 border border-border p-4 rounded-lg space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <button
                onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
                disabled={selectedIndex === 0}
                className="px-2 py-1 bg-muted rounded flex items-center gap-1 hover:bg-muted/80 disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Earlier
              </button>
              <span className="text-primary font-bold">
                Checkpoint {selectedIndex + 1} of {history.length}
              </span>
              <button
                onClick={() => setSelectedIndex(Math.min(history.length - 1, selectedIndex + 1))}
                disabled={selectedIndex === history.length - 1}
                className="px-2 py-1 bg-muted rounded flex items-center gap-1 hover:bg-muted/80 disabled:opacity-40"
              >
                Later <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <input
              type="range"
              min={0}
              max={history.length - 1}
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>

          {/* Active Snapshot Viewer */}
          {activeSnapshot && (
            <div className="bg-background border border-primary/30 p-4 rounded-lg space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Eye className="w-4 h-4 text-primary" /> State at {new Date(activeSnapshot.timestamp).toLocaleTimeString()}
                </span>
                <span className="font-mono text-[11px] bg-primary/20 text-primary px-2 py-0.5 rounded">
                  {activeSnapshot.phase} | {activeSnapshot.severity}
                </span>
              </div>

              <p className="text-muted-foreground text-xs">{activeSnapshot.summary}</p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center bg-card p-3 rounded-md font-mono text-[11px]">
                <div>
                  <span className="text-muted-foreground block text-[10px]">Facts:</span>
                  <span className="font-bold text-foreground">{activeSnapshot.factsCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px]">Hypotheses:</span>
                  <span className="font-bold text-foreground">{activeSnapshot.hypothesesCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px]">Evidence:</span>
                  <span className="font-bold text-foreground">{activeSnapshot.evidenceCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px]">Conflicts:</span>
                  <span className="font-bold text-destructive">{activeSnapshot.conflictsCount}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
