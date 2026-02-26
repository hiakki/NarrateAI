/**
 * Email validation: blocks disposable/temporary email providers.
 * This list covers the most common disposable services. The domain
 * check is O(1) using a Set.
 */

const DISPOSABLE_DOMAINS = new Set([
  // Top disposable email services
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "tempmail.com", "temp-mail.org", "temp-mail.io", "throwaway.email",
  "yopmail.com", "yopmail.fr", "yopmail.net", "yopmail.gm",
  "sharklasers.com", "guerrillamailblock.com", "grr.la", "dispostable.com",
  "trashmail.com", "trashmail.me", "trashmail.net", "trashmail.org",
  "mailnesia.com", "maildrop.cc", "discard.email", "tempr.email",
  "getnada.com", "tempail.com", "fakeinbox.com", "emailondeck.com",
  "mailcatch.com", "inboxalias.com", "mintemail.com", "safetymail.info",
  "harakirimail.com", "mytemp.email", "mohmal.com", "burnermail.io",
  "incognitomail.org", "mailsac.com", "tempinbox.com", "tmpmail.net",
  "tmpmail.org", "bupmail.com", "tempmailaddress.com", "mailtemp.info",
  "10minutemail.com", "10minutemail.net", "10minutemail.org", "10minutemail.co.za",
  "20minutemail.com", "20minutemail.it", "tempmailo.com",
  "mailnull.com", "spamgourmet.com", "spamgourmet.net", "guerrillamail.de",
  "jetable.org", "filzmail.com", "mailexpire.com", "maileater.com",
  "emkei.cz", "crazymailing.com", "disposemail.com", "mailforspam.com",
  "tempomail.fr", "courrieltemporaire.com", "meltmail.com",
  "anonbox.net", "spaml.com", "spaml.de", "spambox.us",
  "bobmail.info", "devnullmail.com", "letthemeatspam.com",
  "trashymail.com", "trashymail.net", "mailzilla.com",
  "armyspy.com", "cuvox.de", "dayrep.com", "einrot.com", "fleckens.hu",
  "gustr.com", "jourrapide.com", "rhyta.com", "superrito.com", "teleworm.us",
  "tempmails.net", "tempmails.org", "inbox.lv",
  "ezehe.com", "tmail.ws", "moakt.co", "moakt.ws", "hulapla.de",
  "byom.de", "trash-mail.at", "trash-mail.com", "wegwerfmail.de",
  "wegwerfmail.net", "wegwerfmail.org", "sogetthis.com",
  "mailinator.net", "mailinator.org", "mailinator.us",
  "mailtothis.com", "eyepaste.com", "fastacura.com",
]);

const TRUSTED_PROVIDERS = new Set([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "yahoo.co.jp",
  "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "pm.me",
  "aol.com",
  "zoho.com", "zohomail.in",
  "fastmail.com", "fastmail.fm",
  "tutanota.com", "tuta.io",
  "hey.com",
  "mail.com", "email.com",
  "gmx.com", "gmx.net", "gmx.de",
  "yandex.com", "yandex.ru",
  "rediffmail.com",
]);

export interface EmailValidation {
  valid: boolean;
  reason?: string;
}

export function validateEmailDomain(email: string): EmailValidation {
  const parts = email.toLowerCase().trim().split("@");
  if (parts.length !== 2) {
    return { valid: false, reason: "Invalid email format" };
  }

  const domain = parts[1];

  if (!domain || !domain.includes(".")) {
    return { valid: false, reason: "Invalid email domain" };
  }

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, reason: "Disposable or temporary email addresses are not allowed. Please use a real email." };
  }

  // Block very short TLDs that are often fake (e.g. user@a.b)
  const tld = domain.split(".").pop() ?? "";
  if (tld.length < 2) {
    return { valid: false, reason: "Invalid email domain" };
  }

  return { valid: true };
}

export function isTrustedProvider(email: string): boolean {
  const domain = email.toLowerCase().trim().split("@")[1];
  return TRUSTED_PROVIDERS.has(domain);
}
