import { useApp } from '../../lib/appContext';
import { emptyNewsFeed, MAX_NEWS_FEEDS, NEWS_FEED_NAME_MAX } from '../../lib/newsFeeds';
import type { NewsFeed } from '../../types';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

/** Additional RSS/Atom feeds. Each one becomes its own widget in the layout editor. */
export function NewsFeedsFields({ feeds, onChange }: { feeds: NewsFeed[]; onChange: (feeds: NewsFeed[]) => void }) {
  const { lang } = useApp();
  const da = lang === 'da';
  const update = (id: string, patch: Partial<NewsFeed>) => onChange(feeds.map((feed) => feed.id === id ? { ...feed, ...patch } : feed));

  return <div className="grid gap-3 col-span-full border-t border-divider pt-3.5">
    <div>
      <p className="text-sm font-medium m-0">{da ? 'Flere nyhedsfeeds' : 'Additional news feeds'}</p>
      <p className="text-xs text-fg3 m-0 mt-0.5">{da
        ? 'Hvert feed bliver sin egen widget i layout-editoren, så du kan placere flere nyhedskilder på skærmen.'
        : 'Each feed becomes its own widget in the layout editor, so you can place several news sources on the screen.'}</p>
    </div>
    {feeds.map((feed, index) => <fieldset key={feed.id} className="grid grid-cols-[1fr_2fr_auto_auto] gap-2.5 items-end border border-divider rounded-md p-3 m-0 min-w-0 max-[820px]:grid-cols-1">
      <legend className="sr-only">{da ? `Nyhedsfeed ${index + 1}` : `News feed ${index + 1}`}</legend>
      <Field label={da ? 'Navn (valgfrit)' : 'Name (optional)'} htmlFor={`news-feed-${feed.id}-name`}>
        <Input id={`news-feed-${feed.id}-name`} maxLength={NEWS_FEED_NAME_MAX} value={feed.name} placeholder="DR"
          onChange={(e) => update(feed.id, { name: e.target.value })} />
      </Field>
      <Field label={da ? 'Feed-adresse (HTTPS)' : 'Feed URL (HTTPS)'} htmlFor={`news-feed-${feed.id}-url`}>
        <Input id={`news-feed-${feed.id}-url`} type="url" required maxLength={2048} value={feed.feed_url}
          placeholder="https://example.org/feed.xml" onChange={(e) => update(feed.id, { feed_url: e.target.value })} />
      </Field>
      <Field label={da ? 'Overskrifter' : 'Headlines'} htmlFor={`news-feed-${feed.id}-limit`}>
        <Select id={`news-feed-${feed.id}-limit`} value={String(feed.item_limit)}
          options={[1, 2, 3, 5, 10].map((value) => ({ value: String(value), label: String(value) }))}
          onChange={(e) => update(feed.id, { item_limit: Number(e.target.value) })} />
      </Field>
      <Button variant="text" icon="delete" onClick={() => onChange(feeds.filter((item) => item.id !== feed.id))}
        aria-label={da ? `Fjern nyhedsfeed ${index + 1}` : `Remove news feed ${index + 1}`}>
        {da ? 'Fjern' : 'Remove'}
      </Button>
    </fieldset>)}
    <div>
      <Button variant="outlined" icon="add" disabled={feeds.length >= MAX_NEWS_FEEDS} onClick={() => onChange([...feeds, emptyNewsFeed(feeds)])}>
        {da ? 'Tilføj nyhedsfeed' : 'Add news feed'}
      </Button>
      {feeds.length >= MAX_NEWS_FEEDS && <p className="text-xs text-fg3 m-0 mt-1.5">{da
        ? `Højst ${MAX_NEWS_FEEDS} ekstra feeds.` : `At most ${MAX_NEWS_FEEDS} additional feeds.`}</p>}
      {feeds.length > 0 && <p className="text-xs text-fg3 m-0 mt-1.5">{da
        ? 'Gem, og tilføj derefter feeds til dit layout under Rediger layout. Et fjernet feed vises som utilgængeligt, indtil dets widget fjernes.'
        : 'Save, then add the feeds to your layout in the layout editor. A removed feed shows as unavailable until its widget is removed.'}</p>}
    </div>
  </div>;
}
