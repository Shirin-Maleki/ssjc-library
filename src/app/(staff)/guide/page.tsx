import Link from "next/link";

/**
 * A real, teacher-facing operational guide (product brief §24/§25) — a polished
 * explainer, not developer documentation and not a FAQ wall. Every claim here must
 * match what actually exists today; unbuilt features (Add a Book, Review Later) are
 * described in future tense, deliberately, rather than implying they work now.
 */
export default function GuidePage() {
  return (
    <div className="flex flex-1 flex-col gap-10 pb-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text-primary sm:text-3xl">Library Guide</h1>
        <p className="max-w-xl text-text-secondary">
          How the library is organized, and how to find, return, and add books.
        </p>
      </div>

      <Section heading="How the library is organized">
        <p>
          Every book has exactly <strong>one primary physical category</strong>. That&rsquo;s the one shelf it
          belongs on — simple on purpose, so any book can always be found and returned without guessing.
        </p>
        <p>
          A book can also carry <strong>many digital tags</strong>. Tags help Find a Book understand topics and
          themes, but they never create a second shelf location — tags are for searching, categories are for
          shelving.
        </p>
        <ExampleCard
          category="Animals & Nature"
          tags={["animals", "baby animals", "nature"]}
          note="This book physically lives on the Animals & Nature shelf. The tags just help a search for “baby animals” or “nature” find it."
        />
      </Section>

      <Divider />

      <Section heading="How to find a book">
        <p>Find a Book supports a few ways in, and they all search the same collection:</p>
        <ul className="flex flex-col gap-1.5 pl-5 text-text-secondary [&>li]:list-disc">
          <li>
            <strong className="text-text-primary">Search</strong> by title, author, topic, or a plain description of
            what you need.
          </li>
          <li>
            <strong className="text-text-primary">Browse categories</strong> using the quick pills above the search
            results.
          </li>
          <li>
            <strong className="text-text-primary">Filters</strong> narrow by age, language, format, duration, and
            more, at the same time.
          </li>
          <li>
            <strong className="text-text-primary">Voice Search</strong> — tap the microphone in the search bar and
            say what you&rsquo;re looking for. It fills in the same search box, so you can always see (and edit)
            exactly what it heard.
          </li>
        </ul>
        <p>
          <Link href="/find" className="font-medium text-brand-primary underline underline-offset-4 hover:text-brand-secondary">
            Open Find a Book
          </Link>
        </p>
      </Section>

      <Divider />

      <Section heading="How to return a book">
        <p>This is the one rule worth remembering above all the others:</p>
        <ol className="flex flex-col gap-2 pl-5 text-text-secondary [&>li]:list-decimal [&>li]:pl-1.5">
          <li>Find the book&rsquo;s primary physical category (its detail page always shows this).</li>
          <li>Return it to that category&rsquo;s shelf — never a different one, even if a tag suggests otherwise.</li>
          <li>Within that shelf, books are ordered alphabetically by title.</li>
        </ol>
      </Section>

      <Divider />

      <Section heading="How to add a book">
        <p>
          Book intake isn&rsquo;t built yet. When it arrives, it will guide staff through photographing the cover,
          checking the information the app finds, choosing its primary category, and shelving it — aimed at
          well under a minute of attention per book.
        </p>
      </Section>

      <Divider />

      <Section heading="Review Later">
        <p>
          Also part of that future book-intake flow: if the app can&rsquo;t confidently identify or categorize a
          book, it will be possible to mark it for review rather than forcing a guess. An admin would then resolve
          it with the full information in hand. This doesn&rsquo;t exist yet — there&rsquo;s no review queue today.
        </p>
      </Section>

      <Divider />

      <Section heading="Reading Lists">
        <p>
          Reading Lists are a shared staff resource — any staff member can create one, for a classroom, a topic, a
          season, or a week, and add or remove books freely. A book can belong to several lists at once. Lists are
          for planning and discovery only; they never change a book&rsquo;s physical shelf location.
        </p>
        <p className="text-sm text-text-muted">
          <Link href="/lists" className="font-medium text-text-secondary underline underline-offset-4 hover:text-text-primary">Open Reading Lists</Link>.
        </p>
      </Section>

      <Divider />

      <div className="flex items-start gap-3 rounded-lg border border-accent/40 bg-accent/10 p-4">
        <span aria-hidden="true" className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
        <p className="text-sm text-text-primary">
          <strong>If you&rsquo;re unsure where a book belongs,</strong> use Find a Book to check its primary category
          rather than guessing from its tags — the category shown there is always the real shelf location.
        </p>
      </div>
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text-primary">{heading}</h2>
      <div className="flex flex-col gap-3 text-text-secondary">{children}</div>
    </section>
  );
}

function Divider() {
  return <hr className="border-border" />;
}

function ExampleCard({ category, tags, note }: { category: string; tags: string[]; note: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-subtle p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-muted">Primary category:</span>
        <span className="inline-flex items-center rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 font-medium text-text-primary">
          {category}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-muted">Digital tags:</span>
        {tags.map((tag) => (
          <span key={tag} className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-text-secondary">
            {tag}
          </span>
        ))}
      </div>
      <p className="text-text-muted">{note}</p>
    </div>
  );
}
