import { useEffect, useRef, useState } from 'react';
import { Layout } from '@/components/Layout';
import { LabBrief } from '@/components/LabBrief';
import { Terminal } from '@/components/Terminal';
import { TopologyPanel } from '@/components/TopologyPanel';
import { ObjectivesPanel } from '@/components/ObjectivesPanel';
import { useLabSession } from '@/engine/terminal/useLabSession';
import type { Lab } from '@/engine/types';

/**
 * Pilot/dev view for labs not on the public /try path.
 *
 * Was minimal (terminal-only); now also gates on the lab brief and fires
 * timed hints — the cold-student audit (work-order Fix 6) flagged that the
 * scenario field was never rendered for pilot URLs, so a learner landed at
 * the prompt with no trouble ticket. Mirrors TryMode's brief + hint logic
 * minus the analytics + upgrade CTA (this surface stays private/dev-only).
 */
export function PilotMode({ lab }: { lab: Lab }) {
  const session = useLabSession(lab);

  // Brief gates the terminal on first load. Skippable in one click; topology
  // stays visible the whole time for spatial context — same pattern TryMode uses.
  const [briefDismissed, setBriefDismissed] = useState(false);
  const [labStartedAt, setLabStartedAt] = useState<number | null>(null);

  function startLab() {
    setBriefDismissed(true);
    setLabStartedAt(Date.now());
  }

  function resetLab() {
    session.reset();
    setLabStartedAt(Date.now());
  }

  // Hints surface as system lines in the terminal once their `afterSeconds`
  // elapses. Same ref-based bookkeeping as TryMode: don't fire twice;
  // reset re-arms via the resetToken effect.
  const shownHintsRef = useRef<Set<number>>(new Set());
  const { print: termPrint, allMet, resetToken } = session;
  useEffect(() => {
    shownHintsRef.current = new Set();
  }, [resetToken]);
  useEffect(() => {
    if (!labStartedAt || allMet || lab.hints.length === 0) return;
    const id = setInterval(() => {
      const elapsed = (Date.now() - labStartedAt) / 1000;
      lab.hints.forEach((h, i) => {
        if (elapsed >= h.afterSeconds && !shownHintsRef.current.has(i)) {
          shownHintsRef.current.add(i);
          termPrint([{ kind: 'system', text: `[Hint] ${h.text}` }]);
        }
      });
    }, 1000);
    return () => clearInterval(id);
  }, [labStartedAt, allMet, lab.hints, termPrint]);

  return (
    <Layout
      examLabel={lab.exam}
      labTitle={lab.title}
      topology={
        <TopologyPanel
          devices={session.devices}
          activeDeviceId={session.activeDeviceId}
          activePrompt={session.prompt}
          onSelectDevice={session.setActiveDevice}
          links={lab.topology.links}
        />
      }
      objectives={
        <ObjectivesPanel
          title="Objectives"
          objectives={session.objectives}
          onReset={briefDismissed ? resetLab : undefined}
        />
      }
      terminal={
        briefDismissed ? (
          <Terminal term={session} />
        ) : (
          <LabBrief
            title={lab.title}
            examLabel={lab.exam}
            difficulty={lab.difficulty}
            estimatedMinutes={lab.estimatedMinutes}
            scenario={lab.scenario}
            objectives={lab.objectives.map((o) => ({ id: o.id, text: o.text }))}
            onStart={startLab}
          />
        )
      }
    />
  );
}
