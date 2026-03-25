import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
  title: "DMCA & Copyright Policy — NarrateAI",
  description:
    "How NarrateAI handles copyright claims and DMCA takedown requests.",
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

export default function DmcaPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12 space-y-8">
      {/* Hero */}
      <div className="rounded-xl border bg-muted/30 px-8 py-10 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
          Legal
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          DMCA &amp; Copyright Policy
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated: March 25, 2026
        </p>
        <p className="mt-4 mx-auto max-w-xl text-sm text-muted-foreground leading-relaxed">
          NarrateAI respects the intellectual property rights of others and
          expects its users to do the same. This policy describes how we handle
          copyright infringement claims in accordance with the Digital Millennium
          Copyright Act (DMCA).
        </p>
      </div>

      <SectionCard>
        <h2>1. Our Commitment</h2>
        <Separator className="mb-4" />
        <p>
          NarrateAI provides AI-powered tools that discover, analyze, and
          repurpose publicly available video content. We take copyright
          seriously and have implemented the following safeguards:
        </p>
        <ul>
          <li>
            Our discovery system targets content that is publicly available and
            prioritizes short-form, transformative use cases.
          </li>
          <li>
            Users are required to review all content before publishing and
            ensure their use complies with applicable copyright laws.
          </li>
          <li>
            We promptly respond to valid DMCA takedown notices.
          </li>
        </ul>
      </SectionCard>

      <SectionCard>
        <h2>2. Filing a DMCA Takedown Notice</h2>
        <Separator className="mb-4" />
        <p>
          If you believe that content generated or hosted through NarrateAI
          infringes your copyright, please send a written notice to our
          designated DMCA agent containing:
        </p>
        <ul>
          <li>
            A physical or electronic signature of the copyright owner or a
            person authorized to act on their behalf.
          </li>
          <li>
            Identification of the copyrighted work claimed to have been
            infringed.
          </li>
          <li>
            Identification of the material that is claimed to be infringing,
            including information reasonably sufficient to allow us to locate
            the material (e.g., a URL or video ID).
          </li>
          <li>
            Your contact information: name, address, telephone number, and
            email address.
          </li>
          <li>
            A statement that you have a good-faith belief that the use of the
            material is not authorized by the copyright owner, its agent, or
            the law.
          </li>
          <li>
            A statement, made under penalty of perjury, that the information in
            the notice is accurate and that you are authorized to act on behalf
            of the copyright owner.
          </li>
        </ul>
      </SectionCard>

      <SectionCard>
        <h2>3. Designated DMCA Agent</h2>
        <Separator className="mb-4" />
        <p>Send all DMCA notices to:</p>
        <div className="rounded-lg border bg-muted/40 p-4 not-prose text-sm leading-relaxed">
          <p className="font-medium">NarrateAI — DMCA Agent</p>
          <p className="text-muted-foreground mt-1">
            Email:{" "}
            <a
              href="mailto:dmca@narrateai.com"
              className="text-primary hover:underline"
            >
              dmca@narrateai.com
            </a>
          </p>
        </div>
        <p className="mt-4">
          We aim to acknowledge receipt of all valid notices within 2 business
          days.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>4. How We Respond</h2>
        <Separator className="mb-4" />
        <p>Upon receiving a valid DMCA takedown notice, we will:</p>
        <ul>
          <li>
            Promptly remove or disable access to the allegedly infringing
            material.
          </li>
          <li>
            Notify the user who uploaded or generated the content about the
            takedown.
          </li>
          <li>
            Maintain a record of the notice for compliance purposes.
          </li>
        </ul>
      </SectionCard>

      <SectionCard>
        <h2>5. Counter-Notification</h2>
        <Separator className="mb-4" />
        <p>
          If you believe your content was removed in error, you may submit a
          counter-notification containing:
        </p>
        <ul>
          <li>Your physical or electronic signature.</li>
          <li>
            Identification of the material that was removed and the location
            where it appeared before removal.
          </li>
          <li>
            A statement under penalty of perjury that you have a good-faith
            belief the material was removed as a result of mistake or
            misidentification.
          </li>
          <li>
            Your name, address, telephone number, and a statement consenting to
            the jurisdiction of the federal court in your district.
          </li>
        </ul>
        <p>
          Upon receiving a valid counter-notification, we will forward it to the
          original complainant. If they do not file a court action within 10–14
          business days, we may restore the content.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>6. Repeat Infringers</h2>
        <Separator className="mb-4" />
        <p>
          NarrateAI maintains a policy of terminating the accounts of users who
          are repeat copyright infringers. We track DMCA notices per account and
          may suspend or permanently ban accounts with multiple valid strikes.
        </p>
      </SectionCard>

      <SectionCard>
        <h2>7. User Responsibility</h2>
        <Separator className="mb-4" />
        <p>
          While NarrateAI provides tools to discover and repurpose content, you
          are solely responsible for ensuring that any content you publish
          through the Service complies with applicable copyright laws. Our
          discovery features do not constitute legal advice regarding the
          copyright status of any content.
        </p>
      </SectionCard>

      {/* Cross-links */}
      <div className="text-center pb-4">
        <p className="text-sm text-muted-foreground">
          See also our{" "}
          <Link href="/terms" className="text-primary hover:underline font-medium">
            Terms of Service
          </Link>
          {" "}and{" "}
          <Link href="/privacy" className="text-primary hover:underline font-medium">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
