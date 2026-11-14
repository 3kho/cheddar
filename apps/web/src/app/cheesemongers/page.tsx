import { Dashboard, type DashboardSP } from "./dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cheesemongers · Cheddar" };

export default function CheesemongersPage({ searchParams }: { searchParams: Promise<DashboardSP> }) {
  return <Dashboard area="cheesemongers" searchParams={searchParams} />;
}
