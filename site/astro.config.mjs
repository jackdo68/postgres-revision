// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// GitHub Pages project site: https://jackdo68.github.io/postgres-revision/
export default defineConfig({
  site: 'https://jackdo68.github.io',
  base: '/postgres-revision',
  integrations: [
    starlight({
      title: 'Postgres Revision',
      description:
        'A hands-on PostgreSQL course — lessons, exercises, and solutions built on the Pagila database.',
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Course Guide', slug: 'course-guide' },
            { label: 'Commands', slug: 'commands' },
            { label: 'Repo & DB Setup', slug: 'setup' },
          ],
        },
        { label: 'Week 1 · Normalisation', items: [{ autogenerate: { directory: 'week-1-normalisation' } }] },
        { label: 'Week 2 · Keys & IDs', items: [{ autogenerate: { directory: 'week-2-keys-and-ids' } }] },
        { label: 'Week 3 · Relationships & FKs', items: [{ autogenerate: { directory: 'week-3-relationships-and-fks' } }] },
        { label: 'Week 4 · Indexes', items: [{ autogenerate: { directory: 'week-4-indexes' } }] },
        { label: 'Week 5 · Zero-Downtime Migrations', items: [{ autogenerate: { directory: 'week-5-zero-downtime-migrations' } }] },
        { label: 'Week 6 · JSONB', items: [{ autogenerate: { directory: 'week-6-jsonb' } }] },
      ],
    }),
  ],
});
