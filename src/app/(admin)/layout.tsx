import Link from "next/link";
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
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-8 py-0">
        <div className="flex h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                N
              </div>
              <span className="text-lg font-bold tracking-tight">NarrateAI</span>
            </Link>
            <span className="text-sm font-medium text-muted-foreground border-l pl-4">Admin Panel</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              {session.user.name} ({session.user.role.toLowerCase()})
            </span>
            <Link href="/dashboard" className="text-primary hover:underline text-sm">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 bg-muted/30 p-8">{children}</main>

      <footer className="border-t py-4 px-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} NarrateAI. All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link href="/dmca" className="hover:text-foreground transition-colors">DMCA</Link>
            <Link href="/cookies" className="hover:text-foreground transition-colors">Cookies</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
