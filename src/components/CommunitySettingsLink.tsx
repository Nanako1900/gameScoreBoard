import { useEffect, useState } from 'react';
import type { User } from '../types';
import { communityApi } from '../community-api';
import { Link } from './Link';

interface CommunitySettingsLinkProps {
  me: User | null;
}

/** This is a settings destination, rather than a second community introduction. */
export function CommunitySettingsLink({ me }: CommunitySettingsLinkProps): JSX.Element | null {
  if (!me?.is_admin) return null;
  return <AvailableCommunitySettingsLink key={me.id} />;
}

function AvailableCommunitySettingsLink(): JSX.Element | null {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void communityApi.overview(abort.signal).then(value => {
      // The server also verifies community access. A ref or an old local role
      // must not become permission to show this administrator destination.
      if (!abort.signal.aborted) setAvailable(value.me.isAdmin);
    }).catch(() => {
      // D1 and a disabled Node module deliberately answer 404. Other failed
      // reads are not evidence that a private configuration page is available.
      if (!abort.signal.aborted) setAvailable(false);
    });
    return () => abort.abort();
  }, []);
  if (!available) return null;
  // Administrators retain this destination when the member-facing setting is
  // off, so they can turn it back on. A backend 404 above still hides it.
  return <Link to="/settings/community">社区管理</Link>;
}
