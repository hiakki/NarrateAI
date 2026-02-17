import type { UserRole, UserPlan } from "@prisma/client";
import { db } from "@/lib/db";

export function isPrivilegedRole(role: UserRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export const PLAN_LIMITS: Record<
  UserPlan,
  { videosPerMonth: number; maxSeries: number; maxPlatforms: number }
> = {
  FREE: { videosPerMonth: 3, maxSeries: 1, maxPlatforms: 0 },
  STARTER: { videosPerMonth: 30, maxSeries: 5, maxPlatforms: 1 },
  PRO: { videosPerMonth: 100, maxSeries: 20, maxPlatforms: 3 },
  AGENCY: { videosPerMonth: 300, maxSeries: 999, maxPlatforms: 999 },
};

export async function getMonthlyVideoCount(userId: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  return db.video.count({
    where: {
      series: { userId },
      createdAt: { gte: startOfMonth },
      status: { not: "FAILED" },
    },
  });
}

export async function checkVideoLimit(
  userId: string,
  role: UserRole,
  plan: UserPlan
): Promise<{ allowed: boolean; current: number; limit: number }> {
  if (isPrivilegedRole(role)) {
    return { allowed: true, current: 0, limit: Infinity };
  }

  const current = await getMonthlyVideoCount(userId);
  const limit = PLAN_LIMITS[plan].videosPerMonth;
  return { allowed: current < limit, current, limit };
}

export async function checkSeriesLimit(
  userId: string,
  role: UserRole,
  plan: UserPlan
): Promise<{ allowed: boolean; current: number; limit: number }> {
  if (isPrivilegedRole(role)) {
    return { allowed: true, current: 0, limit: Infinity };
  }

  const current = await db.series.count({ where: { userId } });
  const limit = PLAN_LIMITS[plan].maxSeries;
  return { allowed: current < limit, current, limit };
}
