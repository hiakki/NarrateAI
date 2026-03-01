/**
 * Optimal posting windows per niche + language, based on audience behavior.
 *
 * The primary lookup key is `{lang}:{nicheId}` (e.g. "hi:mythology").
 * Falls back to the English/default schedule if no language-specific one exists.
 */

export interface PostingSlot {
  time: string;       // "HH:MM" in viewer TZ
  label: string;      // e.g. "Morning scroll"
}

export interface NicheSchedule {
  viewerTimezone: string;
  viewerRegion: string;
  slots: PostingSlot[];
  reason: string;
}

const US_EAST = "America/New_York";
const US_CENTRAL = "America/Chicago";
const US_WEST = "America/Los_Angeles";
const INDIA = "Asia/Kolkata";

// ─── English (default / US-centric) ──────────────────────────────────

const EN_SCHEDULES: Record<string, NicheSchedule> = {
  "scary-stories": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "21:00", label: "Late night scroll" },
      { time: "22:30", label: "Before sleep" },
      { time: "17:00", label: "After work wind-down" },
    ],
    reason: "Horror performs best at night when viewers are in bed scrolling — the mood matches the content.",
  },
  mythology: {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "12:00", label: "Lunch break" },
      { time: "18:00", label: "Evening commute" },
      { time: "09:00", label: "Morning discovery" },
    ],
    reason: "Educational/story content peaks during lunch breaks and evening commutes when people want to learn something interesting.",
  },
  history: {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "11:00", label: "Late morning" },
      { time: "14:00", label: "Afternoon break" },
      { time: "19:00", label: "Evening" },
    ],
    reason: "History buffs tend to browse during work breaks and evenings. US-centric audience dominates this niche.",
  },
  "true-crime": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "20:00", label: "Prime time" },
      { time: "22:00", label: "Late night" },
      { time: "12:00", label: "Lunch deep-dive" },
    ],
    reason: "True crime viewers binge in the evening. Peak engagement is 8-10 PM when people settle in for the night.",
  },
  "anime-recaps": {
    viewerTimezone: US_WEST,
    viewerRegion: "US (West Coast)",
    slots: [
      { time: "16:00", label: "After school/work" },
      { time: "20:00", label: "Evening watch" },
      { time: "12:00", label: "Lunch break" },
    ],
    reason: "Anime audience skews young (16-28) and US West Coast / global. After-school hours drive the most engagement.",
  },
  "life-hacks": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "07:00", label: "Morning routine" },
      { time: "12:00", label: "Lunch scroll" },
      { time: "17:00", label: "Post-work" },
    ],
    reason: "Life hack content gets saves and shares during morning routines and lunch breaks when people plan their day.",
  },
  motivation: {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "06:00", label: "Early riser" },
      { time: "07:30", label: "Morning commute" },
      { time: "21:00", label: "Night reflection" },
    ],
    reason: "Motivational content hits hardest early morning (people starting their day) and late night (reflecting/planning).",
  },
  "science-facts": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "10:00", label: "Mid-morning" },
      { time: "13:00", label: "After lunch" },
      { time: "19:00", label: "Evening learn" },
    ],
    reason: "Science/education content performs best mid-morning and after lunch when curiosity peaks.",
  },
  "conspiracy-theories": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "23:00", label: "Late night rabbit hole" },
      { time: "21:00", label: "Evening" },
      { time: "14:00", label: "Afternoon" },
    ],
    reason: "Conspiracy content thrives late at night — the classic 'falling down the rabbit hole at 2 AM' effect.",
  },
  "religious-epics": {
    viewerTimezone: US_CENTRAL,
    viewerRegion: "US (Central / Global)",
    slots: [
      { time: "06:00", label: "Morning devotion" },
      { time: "08:00", label: "Weekend morning" },
      { time: "20:00", label: "Evening reflection" },
    ],
    reason: "Faith and spiritual content peaks during morning devotional time and evening wind-down. Broad global appeal across religions.",
  },
  "what-if": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "12:00", label: "Lunch brain food" },
      { time: "18:00", label: "Evening commute" },
      { time: "21:00", label: "Night curiosity" },
    ],
    reason: "What-If scenarios go viral during lunch breaks (shareable) and late evening when curiosity peaks. High comment engagement.",
  },
  "dark-psychology": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "20:00", label: "Evening scroll" },
      { time: "22:00", label: "Late night learning" },
      { time: "12:00", label: "Lunch deep-dive" },
    ],
    reason: "Dark psychology content has insane save-rates. Performs best in evening when people are in 'learning' mode and late night rabbit holes.",
  },
  "space-cosmos": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "21:00", label: "Night sky gazing" },
      { time: "12:00", label: "Lunch mind-blow" },
      { time: "18:00", label: "Evening wonder" },
    ],
    reason: "Space content performs best at night (looking up at stars mood) and lunch breaks. One of the highest share-rates of any niche.",
  },
  "animal-kingdom": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "07:00", label: "Morning scroll" },
      { time: "12:00", label: "Lunch break" },
      { time: "19:00", label: "Evening relaxation" },
    ],
    reason: "Animal content has universal appeal and strong morning/lunch engagement. Family-friendly means it performs across all time slots.",
  },
  survival: {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "18:00", label: "After work" },
      { time: "20:00", label: "Prime time" },
      { time: "13:00", label: "Lunch break" },
    ],
    reason: "Survival content hooks viewers immediately — highest watch-through rate. Evening prime time and lunch breaks drive the most views.",
  },
  "money-wealth": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "06:30", label: "Hustle morning" },
      { time: "12:00", label: "Lunch ambition" },
      { time: "21:00", label: "Night planning" },
    ],
    reason: "Wealth content peaks early morning (hustle culture), lunch (aspiration scroll), and late night (planning/dreaming). Highest save-rate on IG.",
  },
  "funny-stories": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "12:00", label: "Lunch laugh break" },
      { time: "17:00", label: "Post-work pick-me-up" },
      { time: "20:00", label: "Evening scroll" },
    ],
    reason: "Comedy content peaks during lunch breaks and after work when people want to decompress and laugh.",
  },
  "zero-to-hero": {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "06:00", label: "Early riser grind" },
      { time: "07:30", label: "Morning commute" },
      { time: "21:00", label: "Night reflection" },
    ],
    reason: "Underdog stories hit hardest early morning (people starting their day motivated) and at night (reflecting on their own journey).",
  },
  satisfying: {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "22:00", label: "Before sleep zen" },
      { time: "12:00", label: "Lunch scroll" },
      { time: "15:00", label: "Afternoon break" },
    ],
    reason: "Satisfying content performs best during downtime — lunch scroll, afternoon slump, and the pre-sleep relaxation window.",
  },
};

// ─── Hindi (India-centric) ───────────────────────────────────────────

const HI_SCHEDULES: Record<string, NicheSchedule> = {
  "scary-stories": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "21:30", label: "Raat ka scroll" },
      { time: "23:00", label: "Late night binge" },
      { time: "13:00", label: "Dopahar ka break" },
    ],
    reason: "Indian horror fans scroll late at night (9:30–11 PM IST). Lunch break also works — people share scary clips in groups.",
  },
  mythology: {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "06:00", label: "Subah ki shuruat" },
      { time: "12:30", label: "Lunch break" },
      { time: "20:00", label: "Family screen time" },
    ],
    reason: "Mythology (Mahabharata, Ramayan, Shiv) resonates in the morning and during family evening time. Huge engagement on Indian festive days.",
  },
  history: {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "08:00", label: "Morning news time" },
      { time: "13:00", label: "Lunch scroll" },
      { time: "20:30", label: "Evening discovery" },
    ],
    reason: "Indian history content performs during morning routines and after dinner when viewers watch educational Shorts/Reels.",
  },
  "true-crime": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "21:00", label: "Prime time" },
      { time: "22:30", label: "Late night" },
      { time: "13:00", label: "Lunch break" },
    ],
    reason: "True crime is massive in India — evening prime time (9–11 PM IST) dominates, with a secondary lunch peak.",
  },
  "anime-recaps": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "16:00", label: "School ke baad" },
      { time: "21:00", label: "Night watch" },
      { time: "12:00", label: "Lunch break" },
    ],
    reason: "Indian anime audience (13-25 age) is most active after school/college hours and late evening.",
  },
  "life-hacks": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "07:30", label: "Morning routine" },
      { time: "12:30", label: "Lunch scroll" },
      { time: "19:00", label: "Shaam ka time" },
    ],
    reason: "Life hacks trend during morning prep and evening wind-down in India. High save/share rate during lunch.",
  },
  motivation: {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "05:30", label: "Early morning hustle" },
      { time: "07:00", label: "Commute time" },
      { time: "22:00", label: "Raat ki motivation" },
    ],
    reason: "India's motivational content peaks early morning (5:30–7 AM IST for students/hustlers) and late night before sleep.",
  },
  "science-facts": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "08:00", label: "Morning learn" },
      { time: "13:00", label: "After lunch" },
      { time: "19:30", label: "Evening facts" },
    ],
    reason: "Science/education content in Hindi gets traction during study hours and after-dinner screen time.",
  },
  "conspiracy-theories": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "22:30", label: "Raat ka rahasya" },
      { time: "14:00", label: "Dopahar ka bore" },
      { time: "20:00", label: "Evening scroll" },
    ],
    reason: "Conspiracy/mystery Hindi content blows up late at night. Afternoon boredom scrolling is a strong secondary window.",
  },
  "religious-epics": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "06:00", label: "Subah ki prarthana" },
      { time: "20:00", label: "Shaam ki prarthana" },
      { time: "12:00", label: "Dopahar" },
    ],
    reason: "Hindi faith content (Mahabharata, Ramayan, Shiv) resonates morning and evening, aligned with devotional routines in India.",
  },
  "what-if": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "13:00", label: "Lunch ka sochna" },
      { time: "19:00", label: "Shaam ka curiosity" },
      { time: "22:00", label: "Raat ka dimag" },
    ],
    reason: "What-If content in Hindi gets massive shares during lunch and late night. Students and curious minds drive engagement.",
  },
  "dark-psychology": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "21:00", label: "Raat ka gyaan" },
      { time: "13:00", label: "Lunch scroll" },
      { time: "22:30", label: "Late night learning" },
    ],
    reason: "Dark psychology in Hindi has explosive save-rates. Evening and late night are peak times for this 'secret knowledge' content.",
  },
  "space-cosmos": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "21:00", label: "Raat ka aasman" },
      { time: "13:00", label: "Lunch ka mind-blow" },
      { time: "08:00", label: "Subah ka facts" },
    ],
    reason: "Space content in Hindi performs great at night and during study hours. Students are the primary audience.",
  },
  "animal-kingdom": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "07:00", label: "Subah ka scroll" },
      { time: "13:00", label: "Lunch break" },
      { time: "19:00", label: "Shaam ka entertainment" },
    ],
    reason: "Animal content in Hindi has universal family appeal. Morning and evening family screen time drive views.",
  },
  survival: {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "19:00", label: "Shaam ka thrill" },
      { time: "21:00", label: "Prime time" },
      { time: "13:00", label: "Lunch break" },
    ],
    reason: "Survival content in Hindi hooks viewers during evening entertainment hours. Similar pattern to action/thriller content.",
  },
  "money-wealth": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "06:00", label: "Subah ki hustle" },
      { time: "13:00", label: "Lunch ka sapna" },
      { time: "22:00", label: "Raat ka plan" },
    ],
    reason: "Wealth content in Hindi peaks early morning for hustlers/students, lunch for aspiration, and late night for dreamers planning ahead.",
  },
  "funny-stories": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "13:00", label: "Lunch ka mazaak" },
      { time: "18:00", label: "Shaam ka chill" },
      { time: "21:00", label: "Family laugh time" },
    ],
    reason: "Hindi comedy content goes viral during lunch breaks and evening family screen time. WhatsApp sharing peaks post-dinner.",
  },
  "zero-to-hero": {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "05:30", label: "Subah ki hustle" },
      { time: "07:00", label: "Commute motivation" },
      { time: "22:00", label: "Raat ka sapna" },
    ],
    reason: "Underdog stories in Hindi hit hardest early morning for students/hustlers and late night when people dream about their future.",
  },
  satisfying: {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "22:30", label: "Neend se pehle" },
      { time: "13:00", label: "Dopahar ka scroll" },
      { time: "16:00", label: "Afternoon chill" },
    ],
    reason: "Satisfying content in India trends during afternoon downtime and the pre-sleep scrolling window — calming, addictive loops.",
  },
};

// ─── Language → schedule map ─────────────────────────────────────────

const LANGUAGE_SCHEDULES: Record<string, Record<string, NicheSchedule>> = {
  en: EN_SCHEDULES,
  hi: HI_SCHEDULES,
};

const FALLBACK_SCHEDULES: Record<string, NicheSchedule> = {
  en: {
    viewerTimezone: US_EAST,
    viewerRegion: "US (East Coast)",
    slots: [
      { time: "12:00", label: "Lunch break" },
      { time: "18:00", label: "Evening" },
      { time: "09:00", label: "Morning" },
    ],
    reason: "General content performs best around lunch and early evening across most audiences.",
  },
  hi: {
    viewerTimezone: INDIA,
    viewerRegion: "India",
    slots: [
      { time: "12:30", label: "Lunch break" },
      { time: "20:00", label: "Shaam ka time" },
      { time: "07:00", label: "Morning" },
    ],
    reason: "Hindi content performs best during lunch (12:30 PM) and evening family screen time (8 PM IST).",
  },
};

export function getScheduleForNiche(nicheId: string, language: string = "en"): NicheSchedule {
  const langSchedules = LANGUAGE_SCHEDULES[language];
  if (langSchedules?.[nicheId]) return langSchedules[nicheId];

  // Fall back to English schedule for the niche
  if (EN_SCHEDULES[nicheId]) return EN_SCHEDULES[nicheId];

  // Fall back to language-specific generic schedule
  return FALLBACK_SCHEDULES[language] ?? FALLBACK_SCHEDULES.en;
}

/**
 * Convert a time from one timezone to another.
 * Returns "HH:MM" string in the target timezone.
 */
export function convertTime(time: string, fromTz: string, toTz: string): string {
  const [h, m] = time.split(":").map(Number);
  const refDate = new Date(2025, 5, 15, h, m, 0);

  const fromOffset = getTimezoneOffsetMinutes(refDate, fromTz);
  const toOffset = getTimezoneOffsetMinutes(refDate, toTz);

  const utcMinutes = h * 60 + m + fromOffset;
  let targetMinutes = utcMinutes - toOffset;

  targetMinutes = ((targetMinutes % 1440) + 1440) % 1440;

  const th = Math.floor(targetMinutes / 60);
  const tm = targetMinutes % 60;
  return `${String(th).padStart(2, "0")}:${String(tm).padStart(2, "0")}`;
}

function getTimezoneOffsetMinutes(date: Date, tz: string): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: tz });
  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  return (utcDate.getTime() - tzDate.getTime()) / 60000;
}
