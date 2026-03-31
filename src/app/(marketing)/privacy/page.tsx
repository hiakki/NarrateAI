import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
  title: "Privacy Policy — NarrateAI",
  description: "How NarrateAI collects, uses, and protects your personal information.",
};

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6 sm:p-8 prose prose-neutral dark:prose-invert prose-headings:mt-0 prose-headings:mb-3 prose-p:text-sm prose-p:leading-relaxed prose-li:text-sm prose-li:leading-relaxed max-w-none">
        {children}
      </CardContent>
    </Card>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12 space-y-8">
      {/* Hero */}
      <div className="rounded-xl border bg-muted/30 px-8 py-10 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
          Legal
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated: March 25, 2026
        </p>
        <p className="mt-4 mx-auto max-w-xl text-sm text-muted-foreground leading-relaxed">
          NarrateAI (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates
          the NarrateAI platform (the &ldquo;Service&rdquo;). This Privacy Policy explains
          how we collect, use, disclose, and safeguard your information.
        </p>
      </div>

      {/* Sections */}
      <SectionCard>
        <h2>1. Information We Collect</h2>
        <Separator className="mb-4" />

        <h3 className="text-base font-semibold mt-5">1.1 Account Information</h3>
        <p>
          When you register, we collect your name, email address, and password
          (stored as a salted hash). If you sign in through a third-party provider
          (Google, Facebook, or similar), we receive your profile name, email, and
          profile picture from that provider.
        </p>

        <h3 className="text-base font-semibold mt-5">1.2 Connected Social Accounts</h3>
        <p>
          To publish videos on your behalf, we request OAuth tokens for platforms
          you choose to connect (YouTube, Facebook, Instagram, TikTok). These
          tokens are encrypted at rest and are used solely to upload and schedule
          content you authorize. We do not read your private messages, contacts,
          or any data beyond what is necessary for publishing.
        </p>

        <h3 className="text-base font-semibold mt-5">1.3 Content You Create</h3>
        <p>
          We store the videos, scripts, images, voiceovers, automation settings,
          and other content you generate or configure through the Service. This
          data remains associated with your account and is not shared with other users.
        </p>

        <h3 className="text-base font-semibold mt-5">1.4 Usage Data</h3>
        <p>
          We automatically collect standard technical information such as IP address,
          browser type, device type, pages visited, and timestamps. This helps us
          maintain, improve, and secure the Service.
        </p>

        <h3 className="text-base font-semibold mt-5">1.5 Cookies</h3>
        <p>
          We use essential cookies for authentication and session management. We do
          not use advertising or third-party tracking cookies.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>2. How We Use Your Information</h2>
        <Separator className="mb-4" />
        <ul>
          <li>Provide, operate, and maintain the Service.</li>
          <li>Generate and publish video content as directed by you.</li>
          <li>Authenticate your identity and manage your account.</li>
          <li>Communicate with you about your account, updates, or support requests.</li>
          <li>Monitor usage patterns to improve performance and reliability.</li>
          <li>Comply with legal obligations.</li>
        </ul>
      </SectionCard>

      <SectionCard>
        <h2>3. Third-Party Services</h2>
        <Separator className="mb-4" />
        <p>We integrate with the following categories of third-party services:</p>
        <ul>
          <li>
            <strong>AI Providers</strong> — We send prompts and content parameters to
            AI model providers (e.g., OpenAI, Anthropic, Replicate) to generate
            scripts, images, and voiceovers. These providers process data under
            their own privacy policies.
          </li>
          <li>
            <strong>Social Media Platforms</strong> — When you connect YouTube,
            Facebook, Instagram, or TikTok, we use their APIs to publish content.
            These platforms govern data they receive under their own policies.
          </li>
          <li>
            <strong>Hosting &amp; Infrastructure</strong> — Your data is stored on
            servers provided by our hosting providers, secured with industry-standard
            encryption.
          </li>
        </ul>
      </SectionCard>

      <SectionCard>
        <h2>4. Data Retention</h2>
        <Separator className="mb-4" />
        <p>
          We retain your account data and content for as long as your account is
          active. If you delete your account, we will remove your personal data
          within 30 days, except where retention is required by law. Aggregated,
          anonymized analytics data may be retained indefinitely.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>5. Data Security</h2>
        <Separator className="mb-4" />
        <p>
          We implement industry-standard security measures including encryption
          in transit (TLS), encryption at rest for sensitive credentials (OAuth
          tokens, API keys), secure password hashing, and regular access reviews.
          However, no system is 100% secure, and we cannot guarantee absolute security.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>6. Your Rights</h2>
        <Separator className="mb-4" />
        <p>Depending on your jurisdiction, you may have the right to:</p>
        <ul>
          <li>Access, correct, or delete your personal data.</li>
          <li>Export your data in a portable format.</li>
          <li>Withdraw consent for data processing.</li>
          <li>Object to or restrict certain processing activities.</li>
          <li>Lodge a complaint with a supervisory authority.</li>
        </ul>
        <p>
          To exercise any of these rights, contact us at the email address listed below.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>7. Children&apos;s Privacy</h2>
        <Separator className="mb-4" />
        <p>
          The Service is not directed at individuals under the age of 16. We do
          not knowingly collect personal data from children. If we learn that we
          have collected data from a child, we will promptly delete it.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>8. Changes to This Policy</h2>
        <Separator className="mb-4" />
        <p>
          We may update this Privacy Policy from time to time. We will notify
          you of material changes by posting the updated policy on this page and
          updating the &ldquo;Last updated&rdquo; date. Your continued use of the
          Service after changes constitutes acceptance of the updated policy.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>9. Contact Us</h2>
        <Separator className="mb-4" />
        <p>
          If you have questions about this Privacy Policy or your data, please
          contact us at{" "}
          <a href="mailto:privacy@narrateai.com" className="text-primary hover:underline">
            privacy@narrateai.com
          </a>.
        </p>
      </SectionCard>

      {/* Cross-link */}
      <div className="text-center pb-4">
        <p className="text-sm text-muted-foreground">
          See also our{" "}
          <Link href="/terms" className="text-primary hover:underline font-medium">
            Terms of Service
          </Link>
        </p>
      </div>
    </div>
  );
}
