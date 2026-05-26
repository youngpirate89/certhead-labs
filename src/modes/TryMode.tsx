import { useEffect, useRef, useState } from 'react';
import { Layout } from '@/components/Layout';
import { LabBrief } from '@/components/LabBrief';
import { Terminal } from '@/components/Terminal';
import { TopologyPanel } from '@/components/TopologyPanel';
import { ObjectivesPanel } from '@/components/ObjectivesPanel';
import { useLabSession } from '@/engine/terminal/useLabSession';
import { lab01InterfaceIp } from '@/labs/ccna/lab-01-interface-ip';
import { initAnalytics, track } from '@/analytics/posthog';

const REGISTER_URL = 'https://certhead.com/register?source=free-lab';

/**
 * Public free-lab route (`/try`). No auth, hardcoded to the single free lab.
 * On completion, shows the upgrade CTA — AFTER completion, never during
 * (CLAUDE.md free-lab design principle). No CertHead API calls. Anonymous
 * PostHog funnel events only: viewed -> started -> completed -> cta_clicked.
 */
export function TryMode() {
  const lab = lab01InterfaceIp;
  const session = useLabSession(lab);

  // Funnel top: one view event on mount.
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

  // Brief gates the terminal on first load. Skippable in one click; topology
  // stays visible the whole time for spatial context.
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

  // Hints live in the objectives panel (timer-gated, click-to-reveal); no
  // auto-print to the terminal. Funnel tracking still wants a 'hint_shown'
  // signal — wired through the panel via the reveal callback below.
  function trackHintReveal(index: number) {
    track('hint_shown', { labId: lab.id, hintIndex: index });
  }

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
          hints={lab.hints.map((h, i) => ({
            index: i,
            text: h.text,
            afterSeconds: h.afterSeconds,
          }))}
          labStartedAt={labStartedAt}
          resetToken={session.resetToken}
          onRevealHint={trackHintReveal}
        />
      }
      terminal={
        briefDismissed ? (
          <div className="relative h-full">
            <Terminal term={session} />
            {completed && <CompletionCard labId={lab.id} />}
          </div>
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

function CompletionCard({ labId }: { labId: string }) {
  return (
    <div className="animate-slide-up absolute inset-x-0 bottom-0 border-t border-terminal-prompt/40 bg-panel-header/95 p-5 backdrop-blur">
      <div className="animate-celebrate mx-auto flex max-w-2xl items-center gap-4 rounded-md p-1 sm:flex-row">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-terminal-prompt/70 bg-terminal-prompt/20 text-terminal-prompt">
          <span className="animate-check-pop text-base font-bold">✓</span>
        </div>
        <div className="flex-1">
          <p className="font-sans text-sm font-semibold text-terminal-prompt">
            Lab complete — interface is up.
          </p>
          <p className="mt-0.5 font-sans text-sm text-terminal-fg/80">
            Next: <span className="text-terminal-fg">Lab 04 — Static Routing</span>{' '}
            <span className="text-terminal-dim">(Pro)</span>, plus 20+ more CCNA labs.
          </p>
        </div>
        <a
          href={REGISTER_URL}
          onClick={() => track('cta_clicked', { labId })}
          className="shrink-0 rounded-md bg-terminal-prompt px-4 py-2 text-center font-sans text-sm font-semibold text-[#06231d] transition hover:brightness-110"
        >
          Unlock with CertHead Pro
        </a>
      </div>
    </div>
  );
}
