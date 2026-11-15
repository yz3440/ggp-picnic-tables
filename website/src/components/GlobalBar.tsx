import { button } from "./ui";

export type Section = "archive" | "about";

const SECTIONS: { id: Section; label: string; href: string }[] = [
  { id: "archive", label: "archive", href: "/" },
  { id: "about", label: "about", href: "/about" },
];

/** The one bar: the name on the left, the joined sections on the right. */
export default function GlobalBar({ section, onSection }: { section: Section; onSection: (s: Section) => void }) {
  return (
    <header className="relative z-40 flex h-8 shrink-0 items-center gap-3 border-b border-border bg-background pr-1 pl-3">
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          onSection("archive");
        }}
        className="truncate text-[13px] font-bold"
      >
        <span className="sm:hidden">ggp picnic tables</span>
        <span className="max-sm:hidden">golden gate park picnic tables</span>
      </a>
      <nav aria-label="Sections" className="ml-auto flex shrink-0">
        {SECTIONS.map(({ id, label, href }, i) => (
          <a
            key={id}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onSection(id);
            }}
            aria-current={section === id ? "page" : undefined}
            className={button(section === id ? "secondary" : "outline", "xs", i > 0 ? "-ml-px" : "")}
          >
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}
