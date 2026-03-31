import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Zap,
  BarChart3,
  Globe,
  Shield,
  Mail,
  MessageSquare,
} from "lucide-react";

export const metadata: Metadata = {
  title: "About — NarrateAI",
  description:
    "Learn about NarrateAI — AI-powered faceless video generation for creators and marketers.",
};

const features = [
  {
    icon: Zap,
    title: "AI-Powered Creation",
    description:
      "Generate scripts, voiceovers, images, and fully edited videos using state-of-the-art AI models — no editing skills required.",
  },
  {
    icon: BarChart3,
    title: "Trend Intelligence",
    description:
      "Our scorecard engine discovers trending content across YouTube, Facebook, and Instagram daily, ranking niches by viral potential.",
  },
  {
    icon: Globe,
    title: "Multi-Platform Publishing",
    description:
      "Connect your social accounts and publish directly to YouTube, Instagram, Facebook, and TikTok with optimized posting schedules.",
  },
  {
    icon: Shield,
    title: "Copyright Aware",
    description:
      "Built-in discovery filters prioritize transformative, short-form content. Review everything before it goes live.",
  },
];

const contacts = [
  {
    icon: Mail,
    label: "General Inquiries",
    value: "support@narrateai.com",
    href: "mailto:support@narrateai.com",
  },
  {
    icon: Shield,
    label: "Privacy & Data",
    value: "privacy@narrateai.com",
    href: "mailto:privacy@narrateai.com",
  },
  {
    icon: MessageSquare,
    label: "Legal & DMCA",
    value: "legal@narrateai.com",
    href: "mailto:legal@narrateai.com",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12 space-y-12">
      {/* Hero */}
      <div className="rounded-xl border bg-muted/30 px-8 py-14 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-2xl font-bold">
          N
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          About NarrateAI
        </h1>
        <p className="mt-4 mx-auto max-w-lg text-muted-foreground leading-relaxed">
          NarrateAI is an AI-powered platform that helps creators and marketers
          build, schedule, and publish faceless videos on auto-pilot — from
          script to screen in minutes, not hours.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild>
            <Link href="/register">Get Started Free</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">Sign In</Link>
          </Button>
        </div>
      </div>

      {/* What we do */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-center mb-6">
          What We Do
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <Card key={f.title} className="overflow-hidden">
              <CardContent className="p-6">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {f.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* How it works */}
      <Card className="overflow-hidden">
        <CardContent className="p-6 sm:p-8">
          <h2 className="text-xl font-bold tracking-tight mb-5">
            How It Works
          </h2>
          <Separator className="mb-6" />
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Choose Your Niche",
                desc: "Pick from 20+ pre-analyzed niches or let our scorecard surface the ones trending right now.",
              },
              {
                step: "2",
                title: "AI Builds Your Video",
                desc: "Our pipeline generates a script, voiceover, visuals, and edits everything into a publish-ready video.",
              },
              {
                step: "3",
                title: "Schedule & Publish",
                desc: "Connect your social accounts, pick the best time, and publish — or let automations handle it.",
              },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm">
                  {s.step}
                </div>
                <h3 className="font-semibold mb-1">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Contact */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-center mb-6">
          Contact Us
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {contacts.map((c) => (
            <Card key={c.label} className="overflow-hidden">
              <CardContent className="p-6 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <c.icon className="h-5 w-5 text-primary" />
                </div>
                <p className="font-semibold text-sm mb-1">{c.label}</p>
                <a
                  href={c.href}
                  className="text-sm text-primary hover:underline break-all"
                >
                  {c.value}
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Legal links */}
      <div className="text-center pb-4">
        <p className="text-sm text-muted-foreground">
          <Link href="/privacy" className="text-primary hover:underline font-medium">
            Privacy Policy
          </Link>
          {" · "}
          <Link href="/terms" className="text-primary hover:underline font-medium">
            Terms of Service
          </Link>
          {" · "}
          <Link href="/dmca" className="text-primary hover:underline font-medium">
            DMCA Policy
          </Link>
          {" · "}
          <Link href="/cookies" className="text-primary hover:underline font-medium">
            Cookie Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
