import { brand } from "@/data/brand";
import { anchors } from "@/data/navigation";
import { vibeFrames } from "@/data/vibe";
import { SectionMark } from "@/components/ui/SectionMark";
import { Reveal, RevealLines } from "@/components/motion/Reveal";

/**
 * The brand speaks once: the three-line manifesto and the four pillars,
 * set directly on the surface — no image boxes.
 */
export function Manifesto() {
  const [goodPeople, goodEnergy, unforgettable] = brand.copy.statement;
  const [unforgettableWord, experiencesWord] = unforgettable.split(" ");

  return (
    <section id={anchors.company} aria-labelledby="manifesto-heading" className="relative py-[14svh] sm:py-[18svh]">
      <div className="page-container">
        <Reveal direction="none">
          <SectionMark label="The Company" aside={`Est. ${brand.foundedYear}`} />
        </Reveal>

        <div className="mt-12 grid gap-10 sm:mt-16 lg:grid-cols-12 lg:items-end lg:gap-12">
          <div className="lg:col-span-8">
            <span id="manifesto-heading" className="sr-only">
              {brand.copy.statement.join(" ")}
            </span>
            <RevealLines
              as="p"
              lines={[goodPeople, goodEnergy, unforgettableWord]}
              lineClassNames={["", "text-ivory/80", "text-ivory/60"]}
              className="font-headline text-statement text-ivory"
            />
            <Reveal delay={0.35}>
              <p className="font-display mt-2 text-[clamp(2.1rem,6.2vw,4.75rem)] italic leading-none text-gold-soft">
                {experiencesWord.toLowerCase()}
              </p>
            </Reveal>
          </div>

          <Reveal delay={0.2} className="lg:col-span-4 lg:pb-3">
            <p className="max-w-[36ch] text-[0.95rem] leading-[1.7] text-ivory/70 sm:text-base">{brand.description}</p>
          </Reveal>
        </div>

        <ul className="mt-16 grid grid-cols-2 gap-x-6 gap-y-10 sm:mt-24 lg:grid-cols-4 lg:gap-x-10">
          {vibeFrames.map((pillar, i) => (
            <Reveal as="li" key={pillar.id} delay={0.08 * i} className="border-t border-ivory/12 pt-6">
              <span className="eyebrow text-[0.58rem] text-gold">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="font-headline mt-4 text-[clamp(1.5rem,2.6vw,2.25rem)] text-ivory">{pillar.word}</h3>
              <p className="mt-3 max-w-[24ch] text-[0.85rem] leading-[1.55] text-ivory/55">{pillar.caption}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
