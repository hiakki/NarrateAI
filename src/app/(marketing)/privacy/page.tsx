import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — NarrateAI",
  description: "How NarrateAI collects, uses, and protects your personal information.",
};

export default function PrivacyPolicyPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16 prose prose-neutral dark:prose-invert">
      <Link href="/" className="text-sm text-muted-foreground no-underline hover:text-foreground mb-8 block">
        &larr; Back to Home
      </Link>

      <h1>Privacy Policy</h1>
      <p className="lead">
        Last updated: <time dateTime="2026-03-25">March 25, 2026</time>
      </p>

      <p>
        NarrateAI (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates the NarrateAI platform
        (the &quot;Service&quot;). This Privacy Policy explains how we collect, use,
        disclose, and safeguard your information when you use our Service.
      </p>

      <h2>1. Information We Collect</h2>

      <h3>1.1 Account Information</h3>
      <p>
        When you register, we collect your name, email address, and password
        (stored as a salted hash). If you sign in through a third-party provider
        (Google, Facebook, or similar), we receive your profile name, email, and
        profile picture from that provider.
      </p>

      <h3>1.2 Connected Social Accounts</h3>
      <p>
        To publish videos on your behalf, we request OAuth tokens for platforms
        you choose to connect (YouTube, Facebook, Instagram, TikTok). These
        tokens are encrypted at rest and are used solely to upload and schedule
        content you authorize. We do not read your private messages, contacts,
        or any data beyond what is necessary for publishing.
      </p>

      <h3>1.3 Content You Create</h3>
      <p>
        We store the videos, scripts, images, voiceovers, automation settings,
        and other content you generate or configure through the Service. This
        data remains associated with your account and is not shared with other
        users.
      </p>

      <h3>1.4 Usage Data</h3>
      <p>
        We automatically collect standard technical information such as IP
        address, browser type, device type, pages visited, and timestamps.
        This helps us maintain, improve, and secure the Service.
      </p>

      <h3>1.5 Cookies</h3>
      <p>
        We use essential cookies for authentication and session management. We
        do not use advertising or third-party tracking cookies.
      </p>

      <h2>2. How We Use Your Information</h2>
      <ul>
        <li>Provide, operate, and maintain the Service.</li>
        <li>Generate and publish video content as directed by you.</li>
        <li>Authenticate your identity and manage your account.</li>
        <li>Communicate with you about your account, updates, or support requests.</li>
        <li>Monitor usage patterns to improve performance and reliability.</li>
        <li>Comply with legal obligations.</li>
      </ul>

      <h2>3. Third-Party Services</h2>
      <p>
        We integrate with the following categories of third-party services:
      </p>
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

      <h2>4. Data Retention</h2>
      <p>
        We retain your account data and content for as long as your account is
        active. If you delete your account, we will remove your personal data
        within 30 days, except where retention is required by law. Aggregated,
        anonymized analytics data may be retained indefinitely.
      </p>

      <h2>5. Data Security</h2>
      <p>
        We implement industry-standard security measures including encryption
        in transit (TLS), encryption at rest for sensitive credentials (OAuth
        tokens, API keys), secure password hashing, and regular access reviews.
        However, no system is 100% secure, and we cannot guarantee absolute
        security.
      </p>

      <h2>6. Your Rights</h2>
      <p>Depending on your jurisdiction, you may have the right to:</p>
      <ul>
        <li>Access, correct, or delete your personal data.</li>
        <li>Export your data in a portable format.</li>
        <li>Withdraw consent for data processing.</li>
        <li>Object to or restrict certain processing activities.</li>
        <li>Lodge a complaint with a supervisory authority.</li>
      </ul>
      <p>
        To exercise any of these rights, contact us at the email address listed
        below.
      </p>

      <h2>7. Children&apos;s Privacy</h2>
      <p>
        The Service is not directed at individuals under the age of 16. We do
        not knowingly collect personal data from children. If we learn that we
        have collected data from a child, we will promptly delete it.
      </p>

      <h2>8. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify
        you of material changes by posting the updated policy on this page and
        updating the &quot;Last updated&quot; date. Your continued use of the
        Service after changes constitutes acceptance of the updated policy.
      </p>

      <h2>9. Contact Us</h2>
      <p>
        If you have questions about this Privacy Policy or your data, please
        contact us at{" "}
        <a href="mailto:privacy@narrateai.com">privacy@narrateai.com</a>.
      </p>
    </article>
  );
}
