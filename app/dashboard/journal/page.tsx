import { redirect } from 'next/navigation';

export default function LegacyJournalRoute() {
  redirect('/dashboard/places');
}
