import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({
    where: {
      id: { in: ['189d7031-81c2-46c0-9d63-671c770d9973', '5d6a7b78-6eb8-4a1a-ad9e-f861baa6d245'] }
    },
    select: {
      id: true,
      username: true,
      email: true,
      displayName: true,
      deletedAt: true,
    }
  });
  console.log("Users:", users);
}
main();
