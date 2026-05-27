import { useMemo, useState } from 'react';
import { Layout } from '@/components/Layout';
import { LabBrief } from '@/components/LabBrief';
import { TopologyPanel } from '@/components/TopologyPanel';
import { ObjectivesPanel } from '@/components/ObjectivesPanel';
import { useLabSession } from '@/engine/terminal/useLabSession';
import type { Lab } from '@/engine/types';

/**
 * Pilot/dev view for labs not on the public /try path.
 *
 * Mirrors TryMode minus analytics + the upgrade CTA. Brief gates the lab on
 * first load (overlay above the canvas); the objectives panel hosts the
 * lab's on-demand hint list. Per-device terminals appear as floating panels
 * mounted at the document root (added in Section 2 of this refactor).
 */
export function PilotMode({ lab }: { lab: Lab }) {
  const session = useLabSession(lab);

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

  // Per-lab topology positions: collected here from the lab spec so the
  // renderer can lay out non-linear topologies (Lab 09 router-on-a-stick).
  // The renderer falls back to its linear default when this map is empty
  // or doesn't cover every device.
  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const d of lab.topology.devices) {
      if (d.position) m.set(d.id, d.position);
    }
    return m;
  }, [lab]);

  return (
    <>
      <Layout
        examLabel={lab.exam}
        labTitle={lab.title}
        topology={
          <TopologyPanel
            devices={session.devices}
            activeDeviceId={session.activeDeviceId}
            onSelectDevice={session.setActiveDevice}
            links={lab.topology.links}
            positions={positions}
          />
        }
        objectives={
          <ObjectivesPanel
            title="Objectives"
            objectives={session.objectives}
            onReset={briefDismissed ? resetLab : undefined}
            hints={lab.hints.map((h, i) => ({
              index: i,
              text: h.text,
              afterSeconds: h.afterSeconds,
            }))}
            labStartedAt={labStartedAt}
            resetToken={session.resetToken}
          />
        }
      />
      {!briefDismissed && (
        <div className="fixed inset-0 z-40 bg-[#070a0e]/85 backdrop-blur-sm">
          <LabBrief
            title={lab.title}
            examLabel={lab.exam}
            difficulty={lab.difficulty}
            estimatedMinutes={lab.estimatedMinutes}
            scenario={lab.scenario}
            objectives={lab.objectives.map((o) => ({ id: o.id, text: o.text }))}
            onStart={startLab}
          />
        </div>
      )}
    </>
  );
}
