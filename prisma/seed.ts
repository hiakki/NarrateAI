import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const ownerEmail = process.env.OWNER_EMAIL;

  if (!ownerEmail) {
    console.log("OWNER_EMAIL not set in .env — skipping owner promotion.");
    console.log("Set OWNER_EMAIL in your .env file and re-run: pnpm seed");
    return;
  }

  const user = await db.user.findUnique({
    where: { email: ownerEmail },
  });

  if (!user) {
    console.log(`No user found with email: ${ownerEmail}`);
    console.log("Register an account with this email first, then re-run: pnpm seed");
    return;
  }

  if (user.role === "OWNER") {
    console.log(`User ${ownerEmail} is already the owner.`);
    return;
  }

  await db.user.update({
    where: { email: ownerEmail },
    data: { role: "OWNER" },
  });

  console.log(`Promoted ${ownerEmail} to OWNER role.`);
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
