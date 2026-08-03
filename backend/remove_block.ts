import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  await prisma.block.deleteMany({
    where: {
      blockerId: '189d7031-81c2-46c0-9d63-671c770d9973',
      blockedId: '5d6a7b78-6eb8-4a1a-ad9e-f861baa6d245',
    }
  });
  console.log("Deleted block");
}
main();
