// =========================================================================
// SharingPage.tsx: connections, shared devices and copied layouts/widgets/dashboards
// =========================================================================
import { useApp } from '../lib/appContext';
import { useAuth } from '../hooks/useAuth';
import { ConnectionsCard } from '../components/sharing/ConnectionsCard';
import { DeviceAccessCard } from '../components/sharing/DeviceAccessCard';
import { SharedWithMeCard } from '../components/sharing/SharedWithMeCard';
import { InboxCard } from '../components/sharing/InboxCard';
import { SendCard } from '../components/sharing/SendCard';

export function SharingPage() {
  const { user, isSignedIn } = useAuth();
  // Remount on an account switch so no list from the previous account lingers.
  return isSignedIn && user ? <AccountSharing key={user.id} /> : null;
}

function AccountSharing() {
  const { lang } = useApp();
  const da = lang === 'da';
  return <div className="max-w-[860px] mx-auto px-6 pt-6 pb-20 animate-fade-up max-[820px]:px-4 max-[820px]:pt-5 max-[820px]:pb-16">
    <header className="mb-5">
      <h1 className="text-h2 font-light tracking-tight m-0 mb-1.5">{da ? 'Deling' : 'Sharing'}</h1>
      <p className="text-fg2 text-body m-0">{da
        ? 'Forbind med andre, giv dem adgang til en enhed, eller send dem et layout, en widget eller et dashboard.'
        : 'Connect with other people, give them access to a device, or send them a layout, widget or dashboard.'}</p>
    </header>
    <div className="flex flex-col gap-4">
      <InboxCard />
      <SharedWithMeCard />
      <ConnectionsCard />
      <DeviceAccessCard />
      <SendCard />
    </div>
  </div>;
}
