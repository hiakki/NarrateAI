"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState, useRef, useCallback } from "react";
import { LayoutDashboard, Sparkles, Bot, Film, Settings, LogOut, Shield, Share2, Star, BarChart2, Scissors, Menu, PanelLeftClose, PanelLeft, CalendarClock, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/create", label: "Create", icon: Sparkles },
  { href: "/dashboard/automations", label: "Video Gen", icon: Bot },
  { href: "/dashboard/clip-repurpose", label: "Viral Clips", icon: Scissors },
  { href: "/dashboard/characters", label: "Characters", icon: Star },
  { href: "/dashboard/videos", label: "Videos", icon: Film },
  { href: "/dashboard/scheduler", label: "Scheduler", icon: CalendarClock },
  { href: "/dashboard/channels", label: "Channels", icon: Share2 },
  { href: "/dashboard/scorecard", label: "Scorecard", icon: Trophy },
  { href: "/dashboard/report", label: "Report", icon: BarChart2 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const MD_BREAKPOINT = 768;

const UserSkeleton = () => (
  <div className="flex items-center gap-3 px-3 py-2">
    <div className="h-7 w-7 rounded-full bg-muted animate-pulse" />
    <div className="space-y-1.5">
      <div className="h-3 w-16 rounded bg-muted animate-pulse" />
      <div className="h-2.5 w-12 rounded bg-muted animate-pulse" />
    </div>
  </div>
);

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [mounted, setMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const verifyChecked = useRef(false);

  useEffect(() => {
    setMounted(true);
    const mql = window.matchMedia(`(max-width: ${MD_BREAKPOINT - 1}px)`);
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
      if (e.matches) setSidebarOpen(false);
      else setSidebarOpen(true);
    };
    onChange(mql);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => {
    closeMobileSidebar();
  }, [pathname, closeMobileSidebar]);

  useEffect(() => {
    if (!mounted || status !== "authenticated" || !session?.user) return;
    if (verifyChecked.current) return;
    verifyChecked.current = true;

    fetch("/api/auth/check-verified")
      .then((r) => r.json())
      .then((data) => {
        if (data.verified === false) router.replace("/verify-email");
      })
      .catch(() => {});
  }, [mounted, status, session, router]);

  const user = mounted && status === "authenticated" ? session?.user : undefined;
  const isAdmin = user?.role === "OWNER" || user?.role === "ADMIN";

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar — always visible on all screen sizes */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
        <button
          type="button"
          onClick={() => setSidebarOpen((o) => !o)}
          className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeft className="h-5 w-5" />}
        </button>
        <Link href="/dashboard" className="font-bold text-lg">
          NarrateAI
        </Link>
      </header>

      <div className="flex flex-1">
        {/* Mobile backdrop */}
        <div
          className={cn(
            "fixed inset-0 top-14 z-40 bg-black/50 transition-opacity duration-200 md:hidden",
            sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />

        {/* Sidebar — mobile: fixed overlay; desktop: sticky in-flow */}
        <aside
          className={cn(
            "shrink-0 flex flex-col border-r overflow-hidden transition-[width] duration-200 ease-in-out",
            "fixed top-14 bottom-0 left-0 z-50 bg-background",
            "md:sticky md:top-14 md:z-auto md:h-[calc(100vh-3.5rem)] md:bg-muted/30",
            sidebarOpen ? "w-64" : "w-0 border-r-0",
          )}
        >
          <div className="flex min-w-[16rem] flex-1 flex-col">
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {navItems.map((item) => {
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
              {mounted && isAdmin && (
                <>
                  <Separator className="my-2" />
                  <Link
                    href="/admin"
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      pathname.startsWith("/admin")
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Shield className="h-4 w-4" />
                    Admin Panel
                  </Link>
                </>
              )}
            </nav>
            <Separator />
            <div className="p-3">
              {user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-3 px-3"
                    >
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-xs">
                          {user.name?.charAt(0)?.toUpperCase() ?? "U"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col items-start text-xs">
                        <span className="font-medium">{user.name ?? "User"}</span>
                        <span className="text-muted-foreground">{user.plan?.toLowerCase() ?? "free"} plan</span>
                      </div>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <div className="px-2 py-1.5">
                      <p className="text-sm font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Role: {user.role?.toLowerCase()} | Plan: {user.plan?.toLowerCase()}
                      </p>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard/settings">Settings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => signOut({ callbackUrl: "/" })}
                      className="text-destructive"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <UserSkeleton />
              )}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-auto">
          <div className="p-4 md:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
