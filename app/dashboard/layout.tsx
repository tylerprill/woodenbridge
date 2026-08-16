import type { Metadata } from 'next';
import { getAccountDisplayName } from '@/app/lib/auth/account-display';
import { requireVerifiedSession } from '@/app/lib/auth/session';
import SideNav from '@/components/unclean/dashboard/sidenav';

export const metadata: Metadata = {
  title: 'Your atlas — Field Atlas',
  description: 'Your saved places, field notes, and future journeys.',
};

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireVerifiedSession();

  return (
    <div className="dashboard-shell">
      <SideNav
        role={session.role}
        userEmail={session.user.email}
        userName={getAccountDisplayName(session.user)}
      />
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
