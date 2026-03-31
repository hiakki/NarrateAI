import { createLogger } from "@/lib/logger";

const log = createLogger("Email");

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send email via Resend HTTP API (no npm package needed).
 * Falls back to console logging in development when RESEND_API_KEY is not set.
 *
 * To use: set RESEND_API_KEY and EMAIL_FROM in .env
 * Free tier: 100 emails/day at https://resend.com
 */
export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "NarrateAI <noreply@narrateai.com>";

  if (!apiKey) {
    log.warn(
      `[DEV] No RESEND_API_KEY set. Email would be sent to: ${opts.to}`,
    );
    log.log(`Subject: ${opts.subject}`);
    log.log(`Body:\n${opts.text ?? opts.html}`);
    return true;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      log.error(`Resend API error (${res.status}):`, body);
      return false;
    }

    log.log(`Email sent to ${opts.to}: ${opts.subject}`);
    return true;
  } catch (err) {
    log.error("Failed to send email:", err);
    return false;
  }
}

export function buildVerificationEmail(code: string, name?: string): { subject: string; html: string; text: string } {
  const greeting = name ? `Hi ${name}` : "Hi";
  return {
    subject: `${code} is your NarrateAI verification code`,
    text: `${greeting},\n\nYour verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't create an account, you can ignore this email.\n\n— NarrateAI`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="margin: 0 0 16px; font-size: 20px; color: #111;">${greeting},</h2>
        <p style="margin: 0 0 24px; color: #555; font-size: 15px; line-height: 1.5;">
          Your verification code is:
        </p>
        <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #111;">${code}</span>
        </div>
        <p style="margin: 0 0 8px; color: #888; font-size: 13px;">
          This code expires in 10 minutes.
        </p>
        <p style="margin: 0; color: #888; font-size: 13px;">
          If you didn't create an account, you can ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;" />
        <p style="margin: 0; color: #aaa; font-size: 12px;">NarrateAI</p>
      </div>
    `,
  };
}
