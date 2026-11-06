/**
 * Apply the description whitespace rules to communities saved before them.
 *
 * New and edited descriptions are normalised on save (CreateCommunityDto /
 * UpdateCommunityDto, multiline-text.util). Older rows can still hold space
 * runs, tabs, stray blank lines and padding. Every surface already normalises
 * when it renders, so this is about the stored text: search matching, the
 * length the edit form shows, and anything that reads the column directly.
 *
 * A description that normalises to nothing becomes NULL, as an emptied one
 * does through the API. Line breaks past COMMUNITY_DESCRIPTION_MAX_LINE_BREAKS
 * (which the API now refuses) become spaces.
 *
 * Read-only unless --apply. --apply refuses production without
 * --allow-production (CI or the owner runs it there, never an agent).
 *
 *   npx ts-node scripts/normalize-community-descriptions.ts            # dry run
 *   npx ts-node scripts/normalize-community-descriptions.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from '../src/config';
import { normalizeMultilineText } from '../src/common/utils/multiline-text.util';
import { capLineBreaks } from '../src/communities/community-limits';
import { errorMessage } from '../src/common/utils/error.util';

const APPLY = process.argv.includes('--apply');
const ALLOW_PRODUCTION = process.argv.includes('--allow-production');

/** The text with its invisible characters shown, for the log. */
const visible = (s: string): string =>
  JSON.stringify(s.length > 80 ? `${s.slice(0, 77)}...` : s);

async function main(): Promise<void> {
  if (APPLY && config.isProduction && !ALLOW_PRODUCTION) {
    throw new Error(
      'Refusing to --apply against production. Run it from CI or as the owner with --allow-production.',
    );
  }
  const dbHost = (() => {
    try {
      return new URL(config.database.url).host;
    } catch {
      return '(unparsable)';
    }
  })();
  console.log('Normalize community descriptions');
  console.log(`  environment : ${config.env}`);
  console.log(`  database    : ${dbHost}`);
  console.log(
    `  mode        : ${APPLY ? 'APPLY (writes)' : 'dry run (no writes)'}`,
  );
  console.log('');

  const pool = new Pool({ connectionString: config.database.url, max: 2 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const rows = await prisma.community.findMany({
      where: { description: { not: null } },
      select: { id: true, name: true, description: true },
    });
    let changed = 0;
    let written = 0;
    for (const row of rows) {
      const before = row.description ?? '';
      const after = capLineBreaks(normalizeMultilineText(before));
      if (after === before) continue;
      changed++;
      console.log(`change   ${row.id}  ${row.name}`);
      console.log(`         before ${visible(before)}`);
      console.log(`         after  ${visible(after)}`);
      if (!APPLY) continue;
      // Only if it still holds what was read: an edit made meanwhile wins.
      const res = await prisma.community.updateMany({
        where: { id: row.id, description: before },
        data: { description: after || null },
      });
      written += res.count;
    }
    console.log('');
    console.log(
      `Done. checked=${rows.length} needing-change=${changed}` +
        (APPLY ? ` written=${written}` : ''),
    );
    if (!APPLY && changed > 0) {
      console.log('Dry run: nothing was written. Re-run with --apply to save.');
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(errorMessage(e));
  process.exit(1);
});
