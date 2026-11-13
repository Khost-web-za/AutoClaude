import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SegmentedTabs } from '@/ui/segmented-tabs';

describe('SegmentedTabs', () => {
  it('marks only the current item with aria-current="page"', () => {
    const html = renderToStaticMarkup(
      <SegmentedTabs
        label="Session filter"
        items={[
          { key: 'active', label: 'Active', href: '/?tab=active', count: 3, current: true },
          { key: 'all', label: 'All', href: '/?tab=all', current: false },
        ]}
      />,
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a[^>]*href="\/\?tab=active"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/\?tab=active"/);
    expect(html).toContain('aria-label="Session filter"');
    expect(html).toContain('>3<');
  });
});
