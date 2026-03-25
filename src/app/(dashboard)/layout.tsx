"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState, useRef, useCallback } from "react";
import {
  LayoutDashboard, Sparkles, Bot, Film, Settings, LogOut, Shield,
  Share2, Star, BarChart2, Scissors, PanelLeftClose, PanelLeft,
  CalendarClock, Trophy, ChevronRight,
} from "lucide-react";
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

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    items: [
      { href: "/dashboard", label: "Home", icon: LayoutDashboard },
    ],
  },
  {
    label: "Products",
    items: [
      { href: "/dashboard/create", label: "Create", icon: Sparkles },
      { href: "/dashboard/automations", label: "Video Gen", icon: Bot },
      { href: "/dashboard/clip-repurpose", label: "Viral Clips", icon: Scissors },
      { href: "/dashboard/characters", label: "Characters", icon: Star },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/dashboard/videos", label: "Videos", icon: Film },
      { href: "/dashboard/scheduler", label: "Scheduler", icon: CalendarClock },
    ],
  },
  {
    label: "Performance",
    items: [
      { href: "/dashboard/scorecard", label: "Scorecard", icon: Trophy },
      { href: "/dashboard/report", label: "Report", icon: BarChart2 },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/dashboard/channels", label: "Channels", icon: Share2 },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
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

function NavLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
        isActive
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
    </Link>
  );
}

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

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);

  const groupHasActive = (group: NavGroup) =>
    group.items.some((item) => isActive(item.href));

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleGroup = (label: string) =>
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));

  const isGroupOpen = (group: NavGroup) => {
    if (!group.label) return true;
    if (groupHasActive(group)) return true;
    return !collapsed[group.label];
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
        <button
          type="button"
          onClick={() => setSidebarOpen((o) => !o)}
          className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeft className="h-5 w-5" />}
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            N
          </div>
          <span className="font-bold text-lg tracking-tight">NarrateAI</span>
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

        {/* Sidebar */}
        <aside
          className={cn(
            "shrink-0 flex flex-col border-r overflow-hidden transition-[width] duration-200 ease-in-out",
            "fixed top-14 bottom-0 left-0 z-50 bg-background",
            "md:sticky md:top-14 md:z-auto md:h-[calc(100vh-3.5rem)] md:bg-muted/30",
            sidebarOpen ? "w-60" : "w-0 border-r-0",
          )}
        >
          <div className="flex min-w-[15rem] flex-1 flex-col">
            <nav className="flex-1 overflow-y-auto px-3 py-2">
              {navGroups.map((group, gi) => {
                const open = isGroupOpen(group);
                return (
                  <div key={gi} className={gi > 0 ? "mt-2" : ""}>
                    {group.label ? (
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleGroup(group.label!)}
                        className="flex w-full items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3 w-3 shrink-0 transition-transform duration-200",
                            open && "rotate-90",
                          )}
                        />
                        {group.label}
                      </button>
                    ) : null}
                    {open && (
                      <div className="space-y-0.5">
                        {group.items.map((item) => (
                          <NavLink key={item.href} item={item} isActive={isActive(item.href)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {mounted && isAdmin && (
                <div className="mt-4">
                  <Separator className="mb-3" />
                  <NavLink
                    item={{ href: "/admin", label: "Admin Panel", icon: Shield }}
                    isActive={pathname.startsWith("/admin")}
                  />
                </div>
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

        {/* Main content + footer */}
        <main className="flex-1 min-w-0 overflow-auto flex flex-col">
          <div className="flex-1 p-4 md:p-8">{children}</div>
          <footer className="border-t py-4 px-4 md:px-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground/60">
            <Link href="/privacy" className="hover:text-muted-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-muted-foreground transition-colors">Terms</Link>
            <Link href="/dmca" className="hover:text-muted-foreground transition-colors">DMCA</Link>
            <Link href="/cookies" className="hover:text-muted-foreground transition-colors">Cookies</Link>
            <span className="ml-auto">&copy; {new Date().getFullYear()} NarrateAI. All rights reserved.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
