import type { Metadata } from 'next';

import { auth } from '@/auth';
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

  return (
    <div className="dashboard-shell">
      <SideNav userEmail={session?.user?.email} />
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
