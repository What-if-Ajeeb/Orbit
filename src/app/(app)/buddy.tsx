import { Redirect } from 'expo-router';

/**
 * Flat buddy.tsx used to conflict with the buddy/ folder routes.
 * Keep a tiny redirect so any deep links still land on the main Buddy screen.
 */
export default function BuddyRedirect() {
  return <Redirect href="/buddy" />;
}
