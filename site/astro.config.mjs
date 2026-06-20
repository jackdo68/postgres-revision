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
      logo: { src: './src/assets/logo.svg', alt: 'Postgres Revision' },
      favicon: '/favicon.svg',
      head: [
        // Social preview (Open Graph + Twitter). Absolute URLs required.
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://jackdo68.github.io/postgres-revision/og.png' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://jackdo68.github.io/postgres-revision/og.png' } },
      ],
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
