import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const bucketName = 'email-assets';

  console.log(`Checking if bucket "${bucketName}" exists...`);
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.find(b => b.name === bucketName);

  if (!bucketExists) {
    console.log(`Creating bucket "${bucketName}"...`);
    const { error: createError } = await supabase.storage.createBucket(bucketName, { public: true });
    if (createError) throw createError;
  } else {
    // Ensure it is public just in case
    await supabase.storage.updateBucket(bucketName, { public: true });
  }

  const filePath = path.resolve(__dirname, '../frontend/src/assets/images/wordmark.png');
  const fileBuffer = fs.readFileSync(filePath);

  console.log('Uploading wordmark.png...');
  const { error: uploadError } = await supabase.storage.from(bucketName).upload('wordmark.png', fileBuffer, {
    contentType: 'image/png',
    upsert: true,
  });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl('wordmark.png');
  const publicUrl = publicUrlData.publicUrl;

  console.log(`Upload complete! Public URL: ${publicUrl}`);

  // Update .env file
  const envPath = path.resolve(__dirname, '.env');
  let envContent = fs.readFileSync(envPath, 'utf-8');
  envContent = envContent.replace(/WORDMARK_URL=.*/, `WORDMARK_URL=${publicUrl}`);
  fs.writeFileSync(envPath, envContent);
  console.log('.env file updated with new WORDMARK_URL!');
}

run().catch(console.error);
