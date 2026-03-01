"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState, useRef } from "react";
import { LayoutDashboard, Sparkles, Bot, Film, Settings, LogOut, Shield, Share2, Star } from "lucide-react";
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
  { href: "/dashboard/automations", label: "Automations", icon: Bot },
  { href: "/dashboard/characters", label: "Characters", icon: Star },
  { href: "/dashboard/videos", label: "Videos", icon: Film },
  { href: "/dashboard/channels", label: "Channels", icon: Share2 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

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
  const verifyChecked = useRef(false);

  useEffect(() => setMounted(true), []);

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
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-64 flex-col border-r bg-muted/30">
        <div className="flex h-14 items-center px-6 font-bold text-lg">
          <Link href="/dashboard">NarrateAI</Link>
        </div>
        <Separator />
        <nav className="flex-1 space-y-1 p-3">
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
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
