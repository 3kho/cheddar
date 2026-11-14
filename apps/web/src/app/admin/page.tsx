import { Dashboard, type DashboardSP } from "../cheesemongers/dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Super admin · Cheddar" };

export default function AdminPage({ searchParams }: { searchParams: Promise<DashboardSP> }) {
  return <Dashboard area="admin" searchParams={searchParams} />;
}
