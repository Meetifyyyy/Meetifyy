import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const blocks = await prisma.block.findMany();
  console.log("Blocks:", blocks);
}
main();
