import { useCallback, useMemo, useRef, useState } from 'react';
import { Layout } from '@/components/Layout';
import { LabBrief } from '@/components/LabBrief';
import { TopologyPanel } from '@/components/TopologyPanel';
import { ObjectivesPanel } from '@/components/ObjectivesPanel';
import { FloatingDevicePanel } from '@/components/terminal/FloatingDevicePanel';
import { useLabSession } from '@/engine/terminal/useLabSession';
import type { Lab } from '@/engine/types';

/**
 * Pilot/dev view for labs not on the public /try path.
 *
 * Mirrors TryMode minus analytics + the upgrade CTA. Brief overlays the
 * canvas until dismissed; objectives live in the right-side sidebar.
 * Per-device terminals appear as floating panels (FloatingDevicePanel)
 * mounted at the document root, one per `session.openDeviceIds` entry.
 */
export function PilotMode({ lab }: { lab: Lab }) {
  const session = useLabSession(lab);
  const focus = usePanelFocus();

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

  const handleSelectDevice = useCallback(
    (id: string) => {
      session.setActiveDevice(id);
      focus.bringToFront(id);
    },
    [session, focus],
  );

  const platformById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of lab.topology.devices) m.set(d.id, d.platform);
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
            onSelectDevice={handleSelectDevice}
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

      {briefDismissed &&
        session.openDeviceIds.map((id, i) => (
          <FloatingDevicePanel
            key={id}
            deviceId={id}
            platformLabel={platformById.get(id)}
            term={session.forDevice(id)}
            index={i}
            initialZ={focus.zFor(id)}
            onClose={session.closeDevice}
            onFocus={focus.bringToFront}
          />
        ))}

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

/** Shared focus + z-index manager for floating panels. Single counter that
 *  increments on every focus event; each panel reads its assigned counter
 *  value as a z-index, so the most-recently-focused panel always sits on
 *  top. Floor of `Z_BASE` keeps panels above the topology canvas (z=0) but
 *  below any modal overlay (z=40). */
const Z_BASE = 20;
function usePanelFocus() {
  const [zMap, setZMap] = useState<Record<string, number>>({});
  const counterRef = useRef(0);

  const bringToFront = useCallback((id: string) => {
    counterRef.current += 1;
    const next = counterRef.current;
    setZMap((cur) => ({ ...cur, [id]: next }));
  }, []);

  const zFor = useCallback(
    (id: string) => Z_BASE + (zMap[id] ?? 0),
    [zMap],
  );

  return { bringToFront, zFor };
}
