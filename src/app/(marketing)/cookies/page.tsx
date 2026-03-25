import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
  title: "Cookie Policy — NarrateAI",
  description:
    "How NarrateAI uses cookies and similar technologies on our platform.",
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

export default function CookiePolicyPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12 space-y-8">
      {/* Hero */}
      <div className="rounded-xl border bg-muted/30 px-8 py-10 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
          Legal
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Cookie Policy
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated: March 25, 2026
        </p>
        <p className="mt-4 mx-auto max-w-xl text-sm text-muted-foreground leading-relaxed">
          This Cookie Policy explains what cookies are, how NarrateAI uses them,
          and what choices you have regarding their use.
        </p>
      </div>

      <SectionCard>
        <h2>1. What Are Cookies?</h2>
        <Separator className="mb-4" />
        <p>
          Cookies are small text files stored on your device by your web browser
          when you visit a website. They are widely used to make websites work
          more efficiently, provide a better user experience, and supply
          information to site owners.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>2. Cookies We Use</h2>
        <Separator className="mb-4" />
        <p>
          NarrateAI uses only cookies that are strictly necessary for the
          operation of the platform. We do <strong>not</strong> use advertising,
          tracking, or third-party marketing cookies.
        </p>

        <div className="mt-4 overflow-x-auto not-prose">
          <table className="w-full text-sm border rounded-lg overflow-hidden">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Cookie</th>
                <th className="text-left p-3 font-medium">Purpose</th>
                <th className="text-left p-3 font-medium">Duration</th>
                <th className="text-left p-3 font-medium">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="p-3 font-mono text-xs">next-auth.session-token</td>
                <td className="p-3 text-muted-foreground">
                  Keeps you signed in to your account
                </td>
                <td className="p-3 text-muted-foreground">Session / 30 days</td>
                <td className="p-3">
                  <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                    Essential
                  </span>
                </td>
              </tr>
              <tr>
                <td className="p-3 font-mono text-xs">next-auth.csrf-token</td>
                <td className="p-3 text-muted-foreground">
                  Protects against cross-site request forgery attacks
                </td>
                <td className="p-3 text-muted-foreground">Session</td>
                <td className="p-3">
                  <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                    Essential
                  </span>
                </td>
              </tr>
              <tr>
                <td className="p-3 font-mono text-xs">next-auth.callback-url</td>
                <td className="p-3 text-muted-foreground">
                  Remembers where to redirect you after signing in
                </td>
                <td className="p-3 text-muted-foreground">Session</td>
                <td className="p-3">
                  <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                    Essential
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard>
        <h2>3. Third-Party Cookies</h2>
        <Separator className="mb-4" />
        <p>
          When you connect a social media account (YouTube, Facebook, Instagram,
          TikTok) through our OAuth flow, those platforms may set their own
          cookies during the authentication process. These cookies are governed
          by the respective platform&apos;s cookie policies:
        </p>
        <ul>
          <li>
            <a
              href="https://policies.google.com/technologies/cookies"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Google / YouTube Cookie Policy
            </a>
          </li>
          <li>
            <a
              href="https://www.facebook.com/policies/cookies/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Meta / Facebook Cookie Policy
            </a>
          </li>
          <li>
            <a
              href="https://www.tiktok.com/legal/page/global/cookie-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              TikTok Cookie Policy
            </a>
          </li>
        </ul>
        <p>
          NarrateAI has no control over these third-party cookies and is not
          responsible for their content or behavior.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>4. Managing Cookies</h2>
        <Separator className="mb-4" />
        <p>
          You can control and delete cookies through your browser settings. Most
          browsers allow you to:
        </p>
        <ul>
          <li>View what cookies are stored and delete them individually.</li>
          <li>Block third-party cookies.</li>
          <li>Block cookies from specific sites.</li>
          <li>Block all cookies.</li>
          <li>Delete all cookies when you close your browser.</li>
        </ul>
        <p>
          Please note that blocking essential cookies will prevent you from
          signing in to NarrateAI. If you choose to block these cookies, you
          will not be able to use the authenticated features of the platform.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>5. Do Not Track</h2>
        <Separator className="mb-4" />
        <p>
          NarrateAI does not track users across third-party websites and
          therefore does not respond to Do Not Track (DNT) signals. Since we
          only use essential cookies, your experience remains the same
          regardless of your DNT setting.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>6. Updates to This Policy</h2>
        <Separator className="mb-4" />
        <p>
          We may update this Cookie Policy from time to time. Changes will be
          reflected by the &ldquo;Last updated&rdquo; date at the top of this
          page. We encourage you to review this policy periodically.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>7. Contact Us</h2>
        <Separator className="mb-4" />
        <p>
          If you have any questions about our use of cookies, please contact us
          at{" "}
          <a
            href="mailto:privacy@narrateai.com"
            className="text-primary hover:underline"
          >
            privacy@narrateai.com
          </a>
          .
        </p>
      </SectionCard>

      {/* Cross-links */}
      <div className="text-center pb-4">
        <p className="text-sm text-muted-foreground">
          See also our{" "}
          <Link
            href="/privacy"
            className="text-primary hover:underline font-medium"
          >
            Privacy Policy
          </Link>
          {" "}and{" "}
          <Link
            href="/terms"
            className="text-primary hover:underline font-medium"
          >
            Terms of Service
          </Link>
        </p>
      </div>
    </div>
  );
}
