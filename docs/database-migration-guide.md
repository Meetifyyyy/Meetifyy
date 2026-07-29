# Complete Database Migration Guide

This guide provides a comprehensive, step-by-step process for migrating the **Meetifyy** PostgreSQL database, Supabase authentication data, and storage buckets from one Supabase project to another without data loss.

---

## 1. Overview & Architecture

When migrating between Supabase projects (e.g., changing cloud regions to reduce network latency), a complete migration requires transferring 4 distinct layers:

1. **Database Schema & Indexes**: Pushing Prisma models and composite performance indexes.
2. **Authentication Data**: Transferring user accounts, password hashes, and OAuth identities (`auth.users`, `auth.identities`).
3. **Application Data**: Transferring relational public tables (`User`, `UserSettings`, `Conversation`, `Message`, etc.) in topological dependency order.
4. **Storage Assets**: Copying storage buckets (`meetifyy-dev`) and media files (avatars, activity covers, chat images).

---

## 2. Step-by-Step Migration Process

### Step 1: Create & Obtain Credentials for New Supabase Project

1. Create a new project in the Supabase Dashboard (choose your target region, e.g., `ap-south-1` Mumbai, India).
2. Go to **Project Settings** → **API** to copy:
   - **`Project URL`** (`https://<ref>.supabase.co`)
   - **`anon` Key** (Publishable API key)
   - **`service_role` Key** (Secret admin key)
3. Go to the top header → click **`-o- Connect`** → **ORM** → **Prisma** to copy IPv4 Pooler URLs:
   - **Transaction Pooler (Port 6543)**: For NestJS backend API connections.
   - **Session Pooler (Port 5432)**: For Prisma migrations and schema push.

---

### Step 2: Configure Environment Variables

Update `backend/.env` with your new connection details:

```env
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
DATABASE_URL="postgresql://postgres.<ref>:<url-encoded-pass>@<pooler-host>:6543/postgres?pgbouncer=true&connection_limit=10&pool_timeout=15"
DIRECT_URL="postgresql://postgres.<ref>:<url-encoded-pass>@<pooler-host>:5432/postgres"
```

> **Important**: If your database password contains special characters (`&`, `@`, `#`), URL-encode them (`&` → `%26`, `@` → `%40`).

---

### Step 3: Push Schema & Composite Performance Indexes

Run Prisma schema push to create all tables and custom performance indexes on the new database:

```bash
cd backend
npx prisma db push
npx prisma generate
```

---

### Step 4: Migrate Authentication & User Data (`auth.users`)

Because `auth.users` contains foreign key constraints and generated columns, setting `session_replication_role = 'replica'` temporarily bypasses trigger locks during import:

```javascript
const { Client } = require('pg');

async function migrateAuth() {
  const oldClient = new Client({ connectionString: "OLD_DIRECT_URL" });
  const newClient = new Client({ connectionString: "NEW_DIRECT_URL" });

  await oldClient.connect();
  await newClient.connect();
  await newClient.query('SET session_replication_role = "replica";');

  // 1. Fetch non-generated columns for auth.users
  const colsRes = await newClient.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_schema = 'auth' AND table_name = 'users' AND is_generated != 'ALWAYS';
  `);
  const cols = colsRes.rows.map(c => c.column_name);

  // 2. Transfer auth.users
  const users = await oldClient.query('SELECT * FROM auth.users;');
  for (const user of users.rows) {
    const keys = cols.filter(k => user[k] !== undefined);
    const sql = `INSERT INTO auth.users (${keys.map(k => `"${k}"`).join(',')}) 
                 VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) 
                 ON CONFLICT (id) DO NOTHING;`;
    await newClient.query(sql, keys.map(k => user[k]));
  }

  // 3. Transfer auth.identities
  const identities = await oldClient.query('SELECT * FROM auth.identities;');
  for (const idObj of identities.rows) {
    const keys = Object.keys(idObj).map(k => `"${k}"`).join(',');
    const sql = `INSERT INTO auth.identities (${keys}) 
                 VALUES (${Object.keys(idObj).map((_, i) => `$${i + 1}`).join(',')}) 
                 ON CONFLICT (id) DO NOTHING;`;
    await newClient.query(sql, Object.values(idObj));
  }

  await newClient.query('SET session_replication_role = "origin";');
  await oldClient.end();
  await newClient.end();
}
```

---

### Step 5: Migrate Public Relational Tables

Transfer application tables in topological order (parents before children):

```javascript
const PUBLIC_TABLES = [
  'User',
  'UserSettings',
  'Block',
  'Follow',
  'CrewActivity',
  'ActivityInterest',
  'ActivityParticipant',
  'Conversation',
  'ConversationParticipant',
  'ConversationJoinRequest',
  'Message',
  'DeletedMessage',
  'MessageTarget',
  'Notification',
  'Post',
  'PostLike',
  'Comment',
  'Report'
];

async function migratePublicTables(oldClient, newClient) {
  await newClient.query('SET session_replication_role = "replica";');

  for (const table of PUBLIC_TABLES) {
    const res = await oldClient.query(`SELECT * FROM "public"."${table}";`);
    if (res.rows.length > 0) {
      for (const row of res.rows) {
        const keys = Object.keys(row).map(k => `"${k}"`).join(',');
        const placeholders = Object.keys(row).map((_, i) => `$${i + 1}`).join(',');
        const sql = `INSERT INTO "public"."${table}" (${keys}) VALUES (${placeholders}) ON CONFLICT DO NOTHING;`;
        await newClient.query(sql, Object.values(row));
      }
    }
  }

  await newClient.query('SET session_replication_role = "origin";');
}
```

---

### Step 6: Migrate Storage Buckets & Media Files

Copy files across storage buckets using Supabase `service_role` key:

```javascript
const { createClient } = require('@supabase/supabase-js');

async function migrateStorage() {
  const source = createClient("OLD_SUPABASE_URL", "OLD_SERVICE_KEY");
  const target = createClient("NEW_SUPABASE_URL", "NEW_SERVICE_KEY");

  const { data: buckets } = await source.storage.listBuckets();
  for (const bucket of buckets) {
    await target.storage.createBucket(bucket.name, { public: bucket.public });
    
    // Transfer directory recursively
    await transferDirectory(source, target, bucket.name, '');
  }
}

async function transferDirectory(source, target, bucket, dirPath) {
  const { data: items } = await source.storage.from(bucket).list(dirPath, { limit: 1000 });
  for (const item of items) {
    const fullPath = dirPath ? `${dirPath}/${item.name}` : item.name;
    if (item.id === null) {
      await transferDirectory(source, target, bucket, fullPath);
    } else {
      const { data: blob } = await source.storage.from(bucket).download(fullPath);
      const buffer = Buffer.from(await blob.arrayBuffer());
      await target.storage.from(bucket).upload(fullPath, buffer, { upsert: true });
    }
  }
}
```

---

## 3. Production Deployment Checklist

### Railway (Backend Host)
Update service environment variables:
- `DATABASE_URL` (Port `6543` with `?pgbouncer=true&connection_limit=10&pool_timeout=15`)
- `DIRECT_URL` (Port `5432`)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Vercel (Frontend Host)
Update project environment variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` (Railway production URL)

### Supabase Dashboard Settings
1. **Authentication → URL Configuration**:
   - Set Site URL: `https://meetify-web.vercel.app`
   - Set Allowed Redirect URLs: `https://meetify-web.vercel.app/**`
2. **Storage → Buckets**:
   - Ensure `meetifyy-dev` bucket privacy is set to **Public**.
3. **Authentication → Email Settings**:
   - Enable Custom SMTP (Resend host `smtp.resend.com`, port `465`/`587`).

---

## 4. Post-Migration Verification

Run service performance benchmarks to confirm optimal read and write latencies:

```bash
# Read Path Benchmark (getUserConversations & getConversationHistory)
node dist/benchmark_all_endpoints.js
```

Target Production Performance:
- **`GET /api/messages`**: `< 5 ms`
- **`GET /api/messages/:id`**: `< 10 ms`
- **`POST /api/messages`**: `< 30 ms`
