import { Tour } from "@/components/Tour";
import { safeReturnTo } from "@/lib/oauth";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "How it works · Cheddar",
  description: "A two-minute guide to Cheddar: how prices, shares, Latta Cheese and results work.",
};

export default async function HowItWorksPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const user = await currentUser();
  const dest = safeReturnTo(returnTo);
  // New people go on to the fair-play page after the tour; everyone else goes back where they were.
  const next = user && !user.hasAcceptedFairPlay ? `/welcome?returnTo=${encodeURIComponent(dest)}` : dest;
  return <Tour loggedIn={!!user} alreadyDone={!!user?.hasSeenTour} next={next} />;
}
