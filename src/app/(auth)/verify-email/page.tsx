"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Mail, CheckCircle2, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function VerifyEmailPage() {
  const router = useRouter();
  const { data: session, status, update: updateSession } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const hasSent = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status !== "authenticated" || hasSent.current) return;

    fetch("/api/auth/check-verified")
      .then((r) => r.json())
      .then((data) => {
        if (data.verified) {
          router.replace("/dashboard");
        } else if (!hasSent.current) {
          hasSent.current = true;
          sendCode();
        }
      })
      .catch(() => {
        if (!hasSent.current) {
          hasSent.current = true;
          sendCode();
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function sendCode() {
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify-email", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 400 && data.error?.includes("already verified")) {
          await updateSession({ user: { ...session?.user, emailVerified: true } });
          router.replace("/dashboard");
          router.refresh();
          return;
        }
        setError(data.error || "Failed to send code");
        return;
      }
      setMaskedEmail(data.email || "");
      setCooldown(60);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Verification failed");
        return;
      }
      setSuccess(true);
      await updateSession({ user: { ...session?.user, emailVerified: true } });
      setTimeout(() => {
        router.replace("/dashboard");
        router.refresh();
      }, 1500);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setVerifying(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (success) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <CheckCircle2 className="h-12 w-12 text-green-600" />
          <p className="text-lg font-semibold">Email Verified!</p>
          <p className="text-sm text-muted-foreground">Redirecting to dashboard...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-2xl font-bold">Verify your email</CardTitle>
        <CardDescription>
          {maskedEmail
            ? <>We sent a 6-digit code to <strong>{maskedEmail}</strong></>
            : "We're sending a verification code to your email"
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleVerify} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(val);
                setError("");
              }}
              className="text-center text-2xl tracking-[0.3em] font-mono h-14"
              autoComplete="one-time-code"
              autoFocus
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={verifying || code.length !== 6}
          >
            {verifying ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...</>
            ) : (
              "Verify Email"
            )}
          </Button>

          <div className="text-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={sending || cooldown > 0}
              onClick={sendCode}
              className="text-muted-foreground"
            >
              {sending ? (
                <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Sending...</>
              ) : cooldown > 0 ? (
                `Resend code in ${cooldown}s`
              ) : (
                "Resend code"
              )}
            </Button>
          </div>

          <div className="text-center pt-2">
            <Link href="/login" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
