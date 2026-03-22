import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const displayName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.firstName ||
        user?.username ||
        user?.emailAddresses[0]?.emailAddress ||
        "Signed in";

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold text-zinc-900">Dashboard</h1>
          <nav className="flex gap-4 text-sm">
            <Link
              href="/dashboard"
              className="text-zinc-600 hover:text-zinc-900"
            >
              Overview
            </Link>
            <Link
              href="/dashboard/chat"
              className="text-zinc-600 hover:text-zinc-900"
            >
              Chat
            </Link>
            <Link
              href="/dashboard/brand"
              className="text-zinc-600 hover:text-zinc-900"
            >
              Brand
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-600">{displayName}</span>
          <SignOutButton>
            <button
              type="button"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
            >
              Sign out
            </button>
          </SignOutButton>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
