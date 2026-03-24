export const BUILD_ALL_TIME = process.env.BUILD_ALL_TIME ?? "04:00";
export const BUILD_ALL_TIMEZONE = process.env.BUILD_ALL_TIMEZONE ?? "Asia/Kolkata";
export const BUILD_WINDOW_MINUTES = 60;

export const FREQ_DAYS: Record<string, number> = {
  daily: 1,
  every_other_day: 2,
  weekly: 7,
};

export function localTimeToUTC(timeStr: string, tz: string): Date {
  const [targetH, targetM] = timeStr.split(":").map(Number);
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const year = parseInt(dateParts.find((p) => p.type === "year")!.value);
  const month = parseInt(dateParts.find((p) => p.type === "month")!.value) - 1;
  const day = parseInt(dateParts.find((p) => p.type === "day")!.value);

  const noonUtc = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const noonParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(noonUtc);
  const noonH = parseInt(noonParts.find((p) => p.type === "hour")!.value);
  const noonM = parseInt(noonParts.find((p) => p.type === "minute")!.value);
  const offsetMin = (noonH * 60 + noonM) - 720;

  const targetUtcMin = targetH * 60 + targetM - offsetMin;
  let guess = new Date(Date.UTC(year, month, day, 0, targetUtcMin, 0));

  for (let i = 0; i < 3; i++) {
    const lp = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(guess);
    const lh = parseInt(lp.find((p) => p.type === "hour")!.value);
    const lm = parseInt(lp.find((p) => p.type === "minute")!.value);
    const diff = (targetH * 60 + targetM) - (lh * 60 + lm);
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff * 60000);
  }
  return guess;
}

export function calendarDaysSinceRun(lastRunAt: Date | null, timezone: string): number {
  if (!lastRunAt) return Infinity;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayStr = fmt.format(new Date());
  const lastStr = fmt.format(lastRunAt);
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
  const lastMs = new Date(lastStr + "T00:00:00Z").getTime();
  return Math.round((todayMs - lastMs) / (24 * 60 * 60 * 1000));
}

export function isInBuildWindow(): boolean {
  const [buildH, buildM] = BUILD_ALL_TIME.split(":").map(Number);
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUILD_ALL_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const nowMin = h * 60 + m;
  const buildMin = buildH * 60 + buildM;
  return nowMin >= buildMin && nowMin < buildMin + BUILD_WINDOW_MINUTES;
}

interface BuildCheckAuto {
  frequency: string;
  timezone: string;
  lastRunAt: Date | null;
  postTime?: string;
}

/**
 * Returns whether the automation's post time is still reachable today.
 * "Reachable" means the post slot is at least 15 min in the future
 * (same threshold used when computing scheduledPostTime).
 */
function postTimeReachableToday(postTime: string, tz: string): boolean {
  const postSlot = postTime.split(",")[0].trim();
  const todayPost = localTimeToUTC(postSlot, tz);
  return todayPost.getTime() >= Date.now() + 15 * 60 * 1000;
}

export function shouldBuildNow(auto: BuildCheckAuto): { build: boolean; reason: string } {
  const gapDays = FREQ_DAYS[auto.frequency] ?? 1;
  const tz = auto.timezone || BUILD_ALL_TIMEZONE;
  const daysSince = calendarDaysSinceRun(auto.lastRunAt, tz);

  if (auto.lastRunAt === null) {
    return { build: false, reason: "new automation — will run on next scheduled day (use Run button for immediate)" };
  }

  if (daysSince < gapDays) {
    return { build: false, reason: `ran ${daysSince}d ago (calendar), need ${gapDays}d gap` };
  }

  if (auto.postTime && !postTimeReachableToday(auto.postTime, tz)) {
    return { build: false, reason: `post time ${auto.postTime} already passed today, deferring to next day` };
  }

  if (isInBuildWindow()) {
    return { build: true, reason: `build window active, due for build (last ran ${daysSince}d ago)` };
  }

  if (daysSince > gapDays) {
    return { build: true, reason: `catch-up: overdue by ${daysSince - gapDays}d, running now` };
  }

  const todayBuild = localTimeToUTC(BUILD_ALL_TIME, BUILD_ALL_TIMEZONE);
  const windowEnd = todayBuild.getTime() + BUILD_WINDOW_MINUTES * 60000;
  if (Date.now() > windowEnd) {
    return { build: true, reason: `catch-up: missed today's ${BUILD_ALL_TIME} window, running now` };
  }

  return { build: false, reason: "outside build window, waiting for today's window" };
}

interface NextRunAuto {
  enabled: boolean;
  frequency: string;
  lastRunAt: Date | null;
  timezone: string;
  postTime?: string;
}

export function computeNextRunAt(auto: NextRunAuto): Date | null {
  if (!auto.enabled) return null;

  const gap = FREQ_DAYS[auto.frequency] ?? 1;
  const tz = auto.timezone || BUILD_ALL_TIMEZONE;
  const daysSince = calendarDaysSinceRun(auto.lastRunAt, tz);

  const now = new Date();
  const todayBuild = localTimeToUTC(BUILD_ALL_TIME, BUILD_ALL_TIMEZONE);
  const buildWindowEnd = todayBuild.getTime() + BUILD_WINDOW_MINUTES * 60000;

  if (auto.lastRunAt === null) {
    if (now.getTime() < buildWindowEnd) return todayBuild;
    return new Date(todayBuild.getTime() + 24 * 60 * 60 * 1000);
  }

  if (daysSince >= gap && auto.postTime && !postTimeReachableToday(auto.postTime, tz)) {
    return new Date(todayBuild.getTime() + 24 * 60 * 60 * 1000);
  }

  if (daysSince > gap) {
    return now;
  }

  if (daysSince >= gap) {
    if (now.getTime() <= buildWindowEnd) {
      return todayBuild;
    }
    return now;
  }

  const daysUntilDue = gap - daysSince;
  return new Date(todayBuild.getTime() + daysUntilDue * 24 * 60 * 60 * 1000);
}

export function computeNextPostAt(postTime: string, timezone: string): Date {
  const postSlot = postTime.split(",")[0].trim();
  const pt = localTimeToUTC(postSlot, timezone);
  if (pt.getTime() < Date.now()) {
    return new Date(pt.getTime() + 24 * 60 * 60 * 1000);
  }
  return pt;
}
