import { primaryNav, secondaryNav } from "@/config/site";
import { NavTile } from "@/components/home/NavTile";
import { SearchBookIcon, AddBookIcon } from "@/components/home/icons";

const primaryIcons = [SearchBookIcon, AddBookIcon];

const primaryAccents: Array<"teal" | "warm"> = ["teal", "warm"];

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col gap-10 sm:gap-12">
      {/* Visually hidden: sighted users get the two dominant tiles below with no extra
          header clutter, per design direction — but the page still needs exactly one h1
          for correct heading hierarchy for screen-reader navigation. */}
      <h1 className="sr-only">Home</h1>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
        {primaryNav.map((item, index) => {
          const Icon = primaryIcons[index];
          return (
            <NavTile
              key={item.href}
              item={item}
              variant="primary"
              icon={Icon ? <Icon /> : undefined}
              accent={primaryAccents[index]}
              dominant={index === 0}
            />
          );
        })}
      </div>
      <nav
        aria-label="More library tools"
        className="flex flex-col gap-1 border-t border-border pt-6 sm:flex-row sm:flex-wrap sm:gap-2 sm:pt-8"
      >
        {secondaryNav.map((item) => (
          <NavTile key={item.href} item={item} variant="secondary" />
        ))}
      </nav>
    </div>
  );
}
