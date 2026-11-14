import { Avatar } from "@/components/Logo";
import { ProfileForm } from "@/components/ProfileForm";
import { MAX_NAME_LENGTH } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit profile · Cheddar" };

export default async function ProfilePage() {
  const user = await requireUser("/profile");
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Edit profile</h1>
      <div className="mb-6 flex items-center gap-3">
        <Avatar slackId={user.slackId} name={user.name} size={48} />
        <div className="text-sm font-semibold">{user.name ?? "Hack Clubber"}</div>
      </div>
      <ProfileForm initialName={user.name ?? ""} maxLength={MAX_NAME_LENGTH} />
    </div>
  );
}
