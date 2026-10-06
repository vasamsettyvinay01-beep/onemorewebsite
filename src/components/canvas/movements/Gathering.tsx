import { brand } from "@/data/brand";
import { anchors } from "@/data/navigation";
import { communityChannels, getSocial } from "@/data/socials";
import { Button } from "@/components/ui/Button";
import { SectionMark } from "@/components/ui/SectionMark";
import { Reveal, RevealLines } from "@/components/motion/Reveal";
import { SocialGlyph } from "@/components/community/SocialGlyph";

/** The journey turns intimate: an invitation, not a social-media block. */
export function Gathering() {
  const whatsapp = getSocial("whatsapp");
  const others = communityChannels.filter((c) => c.id !== "whatsapp");

  return (
    <section id={anchors.gathering} aria-labelledby="gathering-heading" className="relative py-[8svh] sm:py-[10svh]">
      <div className="page-container">
        <Reveal direction="none">
          <SectionMark label="Community" />
        </Reveal>

        <div className="mt-12 grid gap-12 sm:mt-16 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <RevealLines
              as="p"
              lines={[...brand.copy.community.headline]}
              className="font-headline text-statement text-ivory"
            />
            <Reveal as="p" delay={0.3} className="font-display mt-3 text-[clamp(2.1rem,6vw,4.5rem)] italic leading-none text-gold-soft">
              {brand.copy.community.sub.charAt(0) + brand.copy.community.sub.slice(1).toLowerCase()}
            </Reveal>
            <span id="gathering-heading" className="sr-only">
              {brand.copy.community.headline.join(" ")} {brand.copy.community.sub}
            </span>
          </div>

          <Reveal delay={0.4} className="flex flex-col items-start gap-8 lg:col-span-4 lg:items-end lg:pb-3">
            <Button
              href={whatsapp.href}
              target="_blank"
              rel="noopener noreferrer"
              variant="line"
              size="lg"
              trailing={<SocialGlyph id="whatsapp" className="size-3.5" />}
            >
              Join WhatsApp
            </Button>

            <ul className="flex gap-8">
              {others.map((c) => (
                <li key={c.id}>
                  <a
                    href={c.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative block py-2 text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-ivory/70 transition-colors duration-500 hover:text-ivory"
                  >
                    {c.label}
                    <span
                      aria-hidden
                      className="absolute inset-x-0 bottom-0.5 h-px origin-left scale-x-0 bg-gold transition-transform duration-500 ease-(--ease-cinematic) group-hover:scale-x-100"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
