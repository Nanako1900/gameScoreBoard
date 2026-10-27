import { useEffect } from 'react';
import type { Config, RecordItem, User } from '../types';
import { goBack, navigate, type RouterLocation } from '../lib/router';
import { playerCasePath, type RouteLayout } from '../lib/routes';
import { CASE_GONE, CASE_OPENING, CASE_UNAVAILABLE, NOT_FOUND_TITLE, SESSIONS_OFF, SESSIONS_OFF_DESCRIPTION } from '../lib/routeCopy';
import { useCaseLookup, type PinnedCase } from '../lib/useCaseLookup';
import { Modal } from './Modal';
import { NotFound } from './NotFound';
import { PlayerDetail } from './PlayerDetail';
import { BoardPage, type BoardData } from './BoardPage';
import { WelcomePage } from './WelcomePage';
import { GuidePage } from './GuidePage';
import { AdminPage } from './AdminPage';
import type { DiscordLinkRead, DiscordLinkValue } from '../lib/discordLinkState';

export type { PinnedCase };

interface RouteViewProps {
  location: RouterLocation;
  layout: RouteLayout;
  me: User | null;
  config: Config;
  pinned: PinnedCase | null;
  playerRefreshKey: number;
  /** /cases/:id resolved its case: App keeps it, so the case page needs no second GET. */
  onPinned: (pinned: PinnedCase) => void;
  onChanged: () => void;
  onOpenStatement: (record: RecordItem) => void;
  board?: BoardData;
  discordRead?: DiscordLinkRead;
  onDiscordChanged?: (value: DiscordLinkValue) => void;
  onMeUpdated?: (user: User) => void;
  onWelcomeDone?: () => void;
  onBeforeWelcomeBind?: () => void;
  welcomeNotice?: React.ReactNode;
}

/** Every route view closes the same way: back through history, or to '/' if this tab started here. */
const close = (): void => goBack();

function PageShell({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="app__page">{children}</div>;
}

/** Pages sit in the flow where the hidden lobby was; drawers portal out on their own. */
function LayoutShell({ layout, children }: { layout: RouteLayout; children: React.ReactNode }): JSX.Element {
  return layout === 'page' ? <PageShell>{children}</PageShell> : <>{children}</>;
}

function RouteNotice({ layout, title }: { layout: RouteLayout; title: string }): JSX.Element {
  if (layout === 'page') {
    return (
      <PageShell>
        <NotFound title={title} />
      </PageShell>
    );
  }
  // Modal moves focus to the heading itself ([data-autofocus]); NotFound must not do it first,
  // or Modal would remember the heading as the place to give focus back to on close.
  return (
    <Modal open variant="drawer" size="lg" labelledBy="notfound-title" onClose={close}>
      <NotFound title={title} autoFocus={false} />
    </Modal>
  );
}

function CaseOpening(): JSX.Element {
  return (
    <PageShell>
      <p className="app__page-status" role="status">
        {CASE_OPENING}
      </p>
    </PageShell>
  );
}

interface CaseRouteProps extends RouteViewProps {
  caseId: number;
  /** null for the /cases/:id alias. */
  userId: string | null;
}

/**
 * /players/:id/cases/:caseId and its /cases/:id alias. Both render this one
 * component at the same place, so the lookup survives the alias' replace.
 */
function CaseRoute(props: CaseRouteProps): JSX.Element | null {
  const { caseId, userId, location, layout, pinned, onPinned } = props;
  const { status, record } = useCaseLookup(caseId, pinned);
  const subject = record?.subject.id ?? null;

  useEffect(() => {
    if (record === null || subject === null || subject === userId) return;
    // The alias, or /players/A/cases/7 when 7 is B's: B's address, in place, no error (spec §2.2).
    if (pinned?.caseId !== caseId) onPinned({ caseId, record });
    navigate(playerCasePath(subject, caseId) + location.search, { replace: true });
  }, [record, subject, userId, caseId, location.search, pinned, onPinned]);

  if (status === 'missing' || status === 'error') {
    const title = status === 'missing' ? CASE_GONE : CASE_UNAVAILABLE;
    return <RouteNotice layout={userId === null ? 'page' : layout} title={title} />;
  }
  if (record === null || userId === null || subject !== userId) {
    return userId === null || layout === 'page' ? <CaseOpening /> : null;
  }
  return (
    <LayoutShell layout={layout}>
      <PlayerDetail
        key={`${userId}:${caseId}`}
        variant={layout}
        userId={userId}
        me={props.me}
        config={props.config}
        focusRecordId={caseId}
        pinnedRecord={record}
        refreshKey={props.playerRefreshKey}
        onClose={close}
        onOpenStatement={props.onOpenStatement}
        onChanged={props.onChanged}
      />
    </LayoutShell>
  );
}

/** What the address shows on top of (or instead of) the lobby (contract §4.9). */
export function RouteView(props: RouteViewProps): JSX.Element | null {
  const { location, layout } = props;
  const { route } = location;
  switch (route.name) {
    case 'home':
      return null;
    case 'notFound':
      return <RouteNotice layout="page" title={NOT_FOUND_TITLE} />;
    case 'welcome':
      return <PageShell><WelcomePage key={props.me?.id ?? 'guest'} me={props.me} discord={props.discordRead ?? { value: undefined, loading: false }}
        onDiscordChanged={props.onDiscordChanged ?? (() => {})} onSaved={props.onMeUpdated ?? (() => props.onChanged())}
        onComplete={props.onWelcomeDone ?? (() => navigate('/'))} onBeforeBind={props.onBeforeWelcomeBind} notice={props.welcomeNotice} /></PageShell>;
    case 'guide':
      return <PageShell><GuidePage /></PageShell>;
    case 'admin':
      return <PageShell><AdminPage me={props.me} config={props.config} /></PageShell>;
    case 'board':
      return <PageShell><BoardPage tab={route.tab} config={props.config} me={props.me} data={props.board} /></PageShell>;
    case 'sessionGone':
      return <PageShell><NotFound title={SESSIONS_OFF} description={SESSIONS_OFF_DESCRIPTION}
        actions={[{ label: '回首页', to: '/' }]} /></PageShell>;
    case 'player':
      return (
        <LayoutShell layout={layout}>
          <PlayerDetail
            key={route.userId}
            variant={layout}
            userId={route.userId}
            me={props.me}
            config={props.config}
            refreshKey={props.playerRefreshKey}
            onClose={close}
            onOpenStatement={props.onOpenStatement}
            onChanged={props.onChanged}
          />
        </LayoutShell>
      );
    case 'playerCase':
      return <CaseRoute {...props} caseId={route.caseId} userId={route.userId} />;
    case 'case':
      return <CaseRoute {...props} caseId={route.caseId} userId={null} />;
  }
}
