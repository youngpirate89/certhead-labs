import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '@/components/Layout';
import { LabBrief } from '@/components/LabBrief';
import { TopologyPanel } from '@/components/TopologyPanel';
import { ObjectivesPanel } from '@/components/ObjectivesPanel';
import { FloatingTerminalPanel } from '@/components/terminal/FloatingTerminalPanel';
import { useLabSession } from '@/engine/terminal/useLabSession';
import type { Lab } from '@/engine/types';
import { FREE_CCNA_STARTER_LAB_IDS, getFreeCcnaStarterLabById, getFreeCcnaStarterLabs } from '@/labs/free-starter';
import { DEFAULT_FREE_CCNA_STARTER_LAB_ID, resolveTryModeLabId } from '@/routing/tryLabSelection';
import { initAnalytics, track } from '@/analytics/posthog';
import { buildFreeLabRegisterUrl } from '@/conversion/freeLabIntent';
import {
  appendCampaignAttribution,
  parseCampaignAttribution,
  type CampaignAttribution,
} from '@/conversion/campaignAttribution';

interface CompletionCta {
  readonly href: string;
  readonly label: string;
  readonly target?: '_blank';
  readonly rel?: 'noopener noreferrer';
  readonly nextCopy: string;
  readonly proCopy?: string;
}

function starterTitleWithoutPrefix(title: string): string {
  return title.replace(/^Starter\s+\d+:\s*/, '');
}

function getCompletionCta(
  labId: string,
  campaign: CampaignAttribution | null,
): CompletionCta {
  const currentIndex = FREE_CCNA_STARTER_LAB_IDS.findIndex((id) => id === labId);
  const nextId = currentIndex >= 0 ? FREE_CCNA_STARTER_LAB_IDS[currentIndex + 1] : undefined;
  const nextLab = nextId ? getFreeCcnaStarterLabById(nextId) : null;

  if (nextLab) {
    return {
      href: appendCampaignAttribution(
        `/try?lab=${encodeURIComponent(nextLab.id)}`,
        campaign,
      ),
      label: 'Continue to next free lab',
      nextCopy: `Starter ${currentIndex + 2}, ${starterTitleWithoutPrefix(nextLab.title)}.`,
    };
  }

  return {
    href: buildFreeLabRegisterUrl(labId, campaign),
    label: FREE_LAB_UPSELL_COPY.cta,
    target: '_blank',
    rel: 'noopener noreferrer',
    nextCopy: 'full CCNA lab track (Pro).',
    proCopy: FREE_LAB_UPSELL_COPY.proLibrary,
  };
}

export const FREE_LAB_UPSELL_COPY = {
  proLibrary: 'Pro includes the full 60-lab CCNA library.',
  cta: 'Unlock with CertHead Pro',
} as const;

/**
 * Public free-lab route (`/try`). No auth, scoped to the free CCNA starter labs.
 * On completion, shows the upgrade CTA — AFTER completion, never during
 * (CLAUDE.md free-lab design principle). No CertHead API calls. Anonymous
 * PostHog funnel events only: viewed -> started -> completed -> cta_clicked.
 *
 * Layout is topology-first: the canvas fills the viewport, the objectives
 * sidebar pins to the right. Every open device's CLI lives inside one
 * shared FloatingTerminalPanel — one window, one tab per open device.
 */
export function TryMode() {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const labId = resolveTryModeLabId(search);
  const campaign = useMemo(() => parseCampaignAttribution(search), [search]);
  const campaignProperties = useMemo(() => campaign ?? {}, [campaign]);
  const lab = getFreeCcnaStarterLabById(labId) ?? getFreeCcnaStarterLabById(DEFAULT_FREE_CCNA_STARTER_LAB_ID)!;
  const session = useLabSession(lab);
  const viewedLabIdRef = useRef<string | null>(null);

  useEffect(() => {
    initAnalytics();
    if (viewedLabIdRef.current !== lab.id) {
      viewedLabIdRef.current = lab.id;
      track('lab_viewed', { labId: lab.id, ...campaignProperties });
      track('free_lab_viewed', { lab_id: lab.id, ...campaignProperties });
    }
  }, [lab.id, campaignProperties]);

  // Engagement: fire once when the learner runs their first command.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!startedRef.current && session.commandCount > 0) {
      startedRef.current = true;
      track('lab_started', { labId: lab.id, ...campaignProperties });
    }
  }, [session.commandCount, lab.id, campaignProperties]);

  // Latch completion so the CTA persists even if the learner keeps typing.
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    if (session.allMet && !completed) {
      setCompleted(true);
      track('lab_completed', {
        labId: lab.id,
        commandCount: session.commandCount,
        ...campaignProperties,
      });
      track('free_lab_completed', {
        lab_id: lab.id,
        command_count: session.commandCount,
        ...campaignProperties,
      });
    }
  }, [session.allMet, completed, session.commandCount, lab.id, campaignProperties]);

  const [briefDismissed, setBriefDismissed] = useState(false);
  const [labStartedAt, setLabStartedAt] = useState<number | null>(null);
  const [mobileTerminalSignal, setMobileTerminalSignal] = useState(0);
  const [mobileTopologyFitSignal, setMobileTopologyFitSignal] = useState(0);

  function startLab() {
    setBriefDismissed(true);
    setLabStartedAt(Date.now());
    track('lab_brief_dismissed', { labId: lab.id, ...campaignProperties });
    track('free_lab_started', { lab_id: lab.id, ...campaignProperties });
  }

  function resetLab() {
    session.reset();
    setLabStartedAt(Date.now());
    setCompleted(false);
    startedRef.current = false;
    track('lab_reset', { labId: lab.id, ...campaignProperties });
  }

  function trackHintReveal(index: number) {
    track('hint_shown', { labId: lab.id, hintIndex: index, ...campaignProperties });
  }

  // Topology click: open the device's tab in the shared terminal panel
  // (appends to openDeviceIds if new, marks it active either way).
  const handleSelectDevice = useCallback(
    (id: string) => {
      session.setActiveDevice(id);
      setMobileTerminalSignal((value) => value + 1);
    },
    [session],
  );

  const handleMobileTopologyOpen = useCallback(() => {
    setMobileTopologyFitSignal((value) => value + 1);
  }, []);

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

  const starterLabLinks = useMemo(
    () =>
      getFreeCcnaStarterLabs().map((starterLab, index) => ({
        id: starterLab.id,
        title: starterLab.title,
        estimatedMinutes: starterLab.estimatedMinutes,
        difficulty: starterLab.difficulty,
        href: appendCampaignAttribution(
          `/try?lab=${encodeURIComponent(starterLab.id)}`,
          campaign,
        ),
        isActive: starterLab.id === lab.id,
        sequenceNumber: index + 1,
      })),
    [lab.id, campaign],
  );

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
            fitViewSignal={mobileTopologyFitSignal}
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
        hints={<MobileHintsPanel hints={lab.hints.map((h) => h.text)} />}
        hasHints={lab.hints.length > 0}
        onMobileReset={briefDismissed ? resetLab : undefined}
        onMobileTopologyOpen={handleMobileTopologyOpen}
        mobileTerminalSignal={mobileTerminalSignal}
        terminal={
          briefDismissed ? (
            <FloatingTerminalPanel
              mode="docked"
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
            starterLabs={starterLabLinks}
            onStart={startLab}
          />
        </div>
      )}
      {completed && <CompletionBanner labId={lab.id} campaign={campaign} />}
    </>
  );
}

export function MobileHintsPanel({ hints }: { hints: readonly string[] }) {
  return (
    <div className="h-full overflow-y-auto p-4 font-sans text-sm text-terminal-fg">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-terminal-dim">
        Hints
      </p>
      <p className="mb-4 text-terminal-dim">
        Try the next small step before opening a hint. These are ordered from light nudge to direct guidance.
      </p>
      <ol className="space-y-3">
        {hints.map((hint, index) => (
          <li key={`${index}-${hint}`} className="rounded-lg border border-panel-border bg-[#0d1117] p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-terminal-prompt">
              Hint {index + 1}
            </p>
            <p className="leading-6">{hint}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Completion banner — same content as the previous in-terminal CompletionCard.
 *  Renders as a fixed-position strip at the bottom of the viewport so it works
 *  regardless of which (or how many) floating panels are open. */
export function CompletionBanner({
  labId,
  campaign,
}: {
  labId: string;
  campaign?: CampaignAttribution | null;
}) {
  const resolvedCampaign = campaign === undefined
    ? parseCampaignAttribution(typeof window === 'undefined' ? '' : window.location.search)
    : campaign;
  const cta = getCompletionCta(labId, resolvedCampaign);
  const campaignProperties = resolvedCampaign ?? {};

  return (
    <div className="animate-slide-up fixed inset-x-0 bottom-0 z-30 border-t border-terminal-prompt/40 bg-panel-header/95 p-5 backdrop-blur">
      <div className="animate-celebrate mx-auto flex max-w-2xl items-center gap-4 rounded-md p-1 sm:flex-row">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-terminal-prompt/70 bg-terminal-prompt/20 text-terminal-prompt">
          <span className="animate-check-pop text-base font-bold">✓</span>
        </div>
        <div className="flex-1">
          <p className="font-sans text-sm font-semibold text-terminal-prompt">
            Starter lab complete.
          </p>
          <p className="mt-0.5 font-sans text-sm text-terminal-fg/80">
            Next: <span className="text-terminal-fg">{cta.nextCopy}</span>{' '}
            {cta.proCopy && <span className="text-terminal-dim">{cta.proCopy}</span>}
          </p>
        </div>
        <a
          href={cta.href}
          target={cta.target}
          rel={cta.rel}
          onClick={() => track('cta_clicked', { labId, ...campaignProperties })}
          className="shrink-0 rounded-md bg-terminal-prompt px-4 py-2 text-center font-sans text-sm font-semibold text-[#06231d] transition hover:brightness-110"
        >
          {cta.label}
        </a>
      </div>
    </div>
  );
}
