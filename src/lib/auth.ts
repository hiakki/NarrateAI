import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { validateEmailDomain } from "@/lib/email/validate";
import type { UserRole, UserPlan } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string | null;
      image: string | null;
      role: UserRole;
      plan: UserPlan;
      emailVerified: boolean;
    };
  }
  interface User {
    role: UserRole;
    plan: UserPlan;
    emailVerified: boolean;
  }
}

declare module "next-auth" {
  interface JWT {
    id: string;
    role: UserRole;
    plan: UserPlan;
    emailVerified: boolean;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db) as never,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isValid = await compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatarUrl,
          role: user.role,
          plan: user.plan,
          emailVerified: user.emailVerified,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.plan = user.plan;
        token.emailVerified = user.emailVerified ?? false;
      }

      if (trigger === "update" && session) {
        token.role = session.user.role;
        token.plan = session.user.plan;
        if (session.user.emailVerified !== undefined) {
          token.emailVerified = session.user.emailVerified;
        }
      }

      // Refresh emailVerified from DB if token says unverified (avoids stale JWT)
      if (token.id && token.emailVerified === false) {
        try {
          const dbUser = await db.user.findUnique({
            where: { id: token.id as string },
            select: { emailVerified: true },
          });
          if (dbUser?.emailVerified) {
            token.emailVerified = true;
          }
        } catch {
          // DB error — keep current token value
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
        session.user.plan = token.plan as UserPlan;
        session.user.emailVerified = (token.emailVerified as boolean) ?? false;
      }
      return session;
    },
    async signIn({ user, account }) {
      if (user.email) {
        const emailCheck = validateEmailDomain(user.email);
        if (!emailCheck.valid) return false;
      }

      if (account?.provider === "google") {
        const existingUser = await db.user.findUnique({
          where: { email: user.email! },
        });
        if (existingUser) {
          user.role = existingUser.role;
          user.plan = existingUser.plan;
          user.emailVerified = existingUser.emailVerified;
          // Auto-verify Google users who weren't verified yet
          if (!existingUser.emailVerified) {
            await db.user.update({
              where: { id: existingUser.id },
              data: { emailVerified: true },
            });
            user.emailVerified = true;
          }
        } else {
          user.emailVerified = true;
        }
      }
      return true;
    },
  },
});
