import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '@/components/Layout';
import { LabBrief } from '@/components/LabBrief';
import { TopologyPanel } from '@/components/TopologyPanel';
import { ObjectivesPanel } from '@/components/ObjectivesPanel';
import { FloatingTerminalPanel } from '@/components/terminal/FloatingTerminalPanel';
import { useLabSession } from '@/engine/terminal/useLabSession';
import { lab01InterfaceIp } from '@/labs/ccna/lab-01-interface-ip';
import { initAnalytics, track } from '@/analytics/posthog';

export const FREE_LAB_REGISTER_URL = 'https://certhead.com/register?source=free-lab';

export const FREE_LAB_UPSELL_COPY = {
  nextLab: 'Lab 04: Static Routing',
  proLibrary: 'Pro includes the full 50-lab CCNA library.',
  cta: 'Unlock with CertHead Pro',
} as const;

/**
 * Public free-lab route (`/try`). No auth, hardcoded to the single free lab.
 * On completion, shows the upgrade CTA — AFTER completion, never during
 * (CLAUDE.md free-lab design principle). No CertHead API calls. Anonymous
 * PostHog funnel events only: viewed -> started -> completed -> cta_clicked.
 *
 * Layout is topology-first: the canvas fills the viewport, the objectives
 * sidebar pins to the right. Every open device's CLI lives inside one
 * shared FloatingTerminalPanel — one window, one tab per open device.
 */
export function TryMode() {
  const lab = lab01InterfaceIp;
  const session = useLabSession(lab);

  useEffect(() => {
    initAnalytics();
    track('lab_viewed', { labId: lab.id });
  }, [lab.id]);

  // Engagement: fire once when the learner runs their first command.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!startedRef.current && session.commandCount > 0) {
      startedRef.current = true;
      track('lab_started', { labId: lab.id });
    }
  }, [session.commandCount, lab.id]);

  // Latch completion so the CTA persists even if the learner keeps typing.
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    if (session.allMet && !completed) {
      setCompleted(true);
      track('lab_completed', { labId: lab.id, commandCount: session.commandCount });
    }
  }, [session.allMet, completed, session.commandCount, lab.id]);

  const [briefDismissed, setBriefDismissed] = useState(false);
  const [labStartedAt, setLabStartedAt] = useState<number | null>(null);

  function startLab() {
    setBriefDismissed(true);
    setLabStartedAt(Date.now());
    track('lab_brief_dismissed', { labId: lab.id });
  }

  function resetLab() {
    session.reset();
    setLabStartedAt(Date.now());
    setCompleted(false);
    startedRef.current = false;
    track('lab_reset', { labId: lab.id });
  }

  function trackHintReveal(index: number) {
    track('hint_shown', { labId: lab.id, hintIndex: index });
  }

  // Topology click: open the device's tab in the shared terminal panel
  // (appends to openDeviceIds if new, marks it active either way).
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

  return (
    <>
      <Layout
        examLabel={lab.exam}
        labTitle={lab.title}
        scenario={
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-terminal-dim">
              Scenario
            </p>
            <p>{lab.scenario}</p>
          </div>
        }
        topology={
          <TopologyPanel
            devices={session.devices}
            activeDeviceId={session.activeDeviceId}
            onSelectDevice={handleSelectDevice}
            links={lab.topology.links}
            decorations={lab.topology.decorations}
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
            onRevealHint={trackHintReveal}
            solution={lab.solution}
          />
        }
        hasHints={lab.hints.length > 0}
        onMobileReset={briefDismissed ? resetLab : undefined}
        terminal={
          briefDismissed ? (
            <FloatingTerminalPanel
              mode="docked"
              openDeviceIds={session.openDeviceIds}
              activeDeviceId={session.activeDeviceId}
              forDevice={session.forDevice}
              platformLabel={platformLabel}
              deviceKind={session.deviceKind}
              pcNetwork={session.pcNetwork}
              onPcNetworkApply={session.updatePcNetwork}
              onSelectDevice={session.setActiveDevice}
              onCloseDevice={session.closeDevice}
              onCloseAll={session.closeAllDevices}
            />
          ) : undefined
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
      {completed && <CompletionBanner labId={lab.id} />}
    </>
  );
}

/** Completion banner — same content as the previous in-terminal CompletionCard.
 *  Renders as a fixed-position strip at the bottom of the viewport so it works
 *  regardless of which (or how many) floating panels are open. */
export function CompletionBanner({ labId }: { labId: string }) {
  return (
    <div className="animate-slide-up fixed inset-x-0 bottom-0 z-30 border-t border-terminal-prompt/40 bg-panel-header/95 p-5 backdrop-blur">
      <div className="animate-celebrate mx-auto flex max-w-2xl items-center gap-4 rounded-md p-1 sm:flex-row">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-terminal-prompt/70 bg-terminal-prompt/20 text-terminal-prompt">
          <span className="animate-check-pop text-base font-bold">✓</span>
        </div>
        <div className="flex-1">
          <p className="font-sans text-sm font-semibold text-terminal-prompt">
            Lab complete: interface is up.
          </p>
          <p className="mt-0.5 font-sans text-sm text-terminal-fg/80">
            Next: <span className="text-terminal-fg">{FREE_LAB_UPSELL_COPY.nextLab}</span>{' '}
            <span className="text-terminal-dim">(Pro)</span>. {FREE_LAB_UPSELL_COPY.proLibrary}
          </p>
        </div>
        <a
          href={FREE_LAB_REGISTER_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('cta_clicked', { labId })}
          className="shrink-0 rounded-md bg-terminal-prompt px-4 py-2 text-center font-sans text-sm font-semibold text-[#06231d] transition hover:brightness-110"
        >
          {FREE_LAB_UPSELL_COPY.cta}
        </a>
      </div>
    </div>
  );
}
