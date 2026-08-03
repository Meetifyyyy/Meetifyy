import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { UsersService } from "./users/users.service";
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const usersService = app.get(UsersService);
  try {
    const result = await usersService.getProfileByUsername("sarthak", "5d6a7b78-6eb8-4a1a-ad9e-f861baa6d245");
    console.log("Result:", result.id, result.username);
  } catch (e) {
    console.error("Error:", e);
  }
  await app.close();
}
main();
