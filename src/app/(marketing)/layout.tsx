import Link from "next/link";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1">{children}</div>
      <footer className="border-t py-8 px-6">
        <div className="mx-auto max-w-4xl flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} NarrateAI. All rights reserved.</span>
          <nav className="flex gap-6">
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">
              Terms of Service
            </Link>
            <a href="mailto:support@narrateai.com" className="hover:text-foreground transition-colors">
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
