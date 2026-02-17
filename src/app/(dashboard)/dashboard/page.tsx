import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Film, Video, Zap } from "lucide-react";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { name, role, plan } = session.user;

  return (
    <div>
      <h1 className="text-3xl font-bold">
        Welcome back, {name ?? "there"}
      </h1>
      <p className="mt-1 text-muted-foreground">
        Here&apos;s an overview of your NarrateAI account.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Role</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">
              {role.toLowerCase()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Plan</CardTitle>
            <Film className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">
              {plan.toLowerCase()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Videos This Month</CardTitle>
            <Video className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground mt-1">
              {role === "OWNER" || role === "ADMIN"
                ? "Unlimited (admin)"
                : `of ${plan === "FREE" ? 3 : plan === "STARTER" ? 30 : plan === "PRO" ? 100 : 300} allowed`}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
