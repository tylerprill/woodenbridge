import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { getAccountDisplayName } from '@/app/lib/auth/account-display';
import SideNav from '@/components/unclean/dashboard/sidenav';

export const metadata: Metadata = {
  title: 'Your atlas — Wooden Bridge',
  description: 'Your saved crossings, field notes, and future journeys.',
};

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();

  if (!session?.user || !session.sessionValid) {
    redirect('/login');
  }

  return (
    <div className="dashboard-shell">
      <SideNav
        userEmail={session.user.email}
        userName={getAccountDisplayName(session.user)}
      />
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
