import { DitherField } from "@/components/fx/DitherField";
import { PublicNav } from "@/components/layout/PublicNav";
import { ButtonLink } from "@/components/ui/kit";

export default function Placeholder({ title, notFound = false }: { title: string; notFound?: boolean }) {
  return (
    <>
      <PublicNav />
      <main className="relative grid min-h-[100svh] place-items-center overflow-hidden bg-ink px-5 text-center">
        <DitherField sources={[{ x: 0.5, y: 0.5, strength: 1 }]} palette={["#1c1466", "#3b2bff", "#8a7fff"]} />
        <div className="relative z-10">
          <p className="eyebrow mb-4 text-lilac">{notFound ? "404" : "Coming next"}</p>
          <h1 className="display text-[clamp(3rem,9vw,8rem)]">{title}</h1>
          <ButtonLink to="/" className="mt-10">
            Back home
          </ButtonLink>
        </div>
      </main>
    </>
  );
}
