import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const usersService = app.get(UsersService);
  const prisma = app.get(PrismaService);

  console.log('--- TESTING getProfileByUsername("sarthak") ---');
  try {
    const profile = await usersService.getProfileByUsername('sarthak');
    console.log('SUCCESS! Profile loaded:', JSON.stringify(profile, null, 2));
  } catch (err) {
    console.error('FAILED to load profile for sarthak:', err?.message || err);
  }

  console.log('\n--- DUMPING ALL USERS IN DB ---');
  const allUsers = await prisma.user.findMany({
    select: { id: true, username: true, displayName: true, email: true }
  });
  console.log('ALL USERS IN DB:', JSON.stringify(allUsers, null, 2));

  await app.close();
}

bootstrap().catch(console.error);
