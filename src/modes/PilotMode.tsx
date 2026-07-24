import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '@/components/Layout';
import { LabBrief } from '@/components/LabBrief';
import { TopologyPanel } from '@/components/TopologyPanel';
import { ObjectivesPanel } from '@/components/ObjectivesPanel';
import { FloatingTerminalPanel } from '@/components/terminal/FloatingTerminalPanel';
import { useLabSession } from '@/engine/terminal/useLabSession';
import type { Lab } from '@/engine/types';

/**
 * Pilot/dev view for labs not on the public /try path.
 *
 * Mirrors TryMode minus analytics + the upgrade CTA. Brief overlays the
 * canvas until dismissed; objectives live in the right-side sidebar. Every
 * open device's CLI lives inside one shared FloatingTerminalPanel — one
 * window, one tab per open device.
 */
export function PilotMode({ lab, onCompleted }: { lab: Lab; onCompleted?: () => void }) {
  const session = useLabSession(lab);
  const completedRef = useRef(false);

  useEffect(() => {
    if (session.allMet && !completedRef.current) {
      completedRef.current = true;
      onCompleted?.();
    }
  }, [onCompleted, session.allMet]);

  const [briefDismissed, setBriefDismissed] = useState(false);
  const [labStartedAt, setLabStartedAt] = useState<number | null>(null);

  function startLab() {
    setBriefDismissed(true);
    setLabStartedAt(Date.now());
  }

  function resetLab() {
    session.reset();
    setLabStartedAt(Date.now());
    completedRef.current = false;
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
    },
    [session],
  );

  const platformById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of lab.topology.devices) m.set(d.id, d.platform);
    return m;
  }, [lab]);
  const platformLabel = useCallback((id: string) => platformById.get(id), [platformById]);
  const deviceClassById = useMemo(() => {
    const m = new Map<string, Lab['topology']['devices'][number]['deviceClass']>();
    for (const d of lab.topology.devices) m.set(d.id, d.deviceClass);
    return m;
  }, [lab]);
  const deviceClass = useCallback((id: string) => deviceClassById.get(id), [deviceClassById]);

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
            decorations={lab.topology.decorations}
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
            solution={lab.solution}
          />
        }
      />

      {briefDismissed && (
        <FloatingTerminalPanel
          openDeviceIds={session.openDeviceIds}
          activeDeviceId={session.activeDeviceId}
          forDevice={session.forDevice}
          platformLabel={platformLabel}
          deviceKind={session.deviceKind}
          deviceClass={deviceClass}
          pcNetwork={session.pcNetwork}
          onPcNetworkApply={session.updatePcNetwork}
          onSelectDevice={session.setActiveDevice}
          onCloseDevice={session.closeDevice}
          onCloseAll={session.closeAllDevices}
        />
      )}

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

