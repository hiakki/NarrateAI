import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "OWNER" && session.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background px-8 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">NarrateAI Admin</h1>
          <span className="text-sm text-muted-foreground">
            Logged in as {session.user.name} ({session.user.role.toLowerCase()})
          </span>
        </div>
      </header>
      <main className="p-8">{children}</main>
    </div>
  );
}
