import { PublicNav } from "@/components/layout/PublicNav";
import { Hero } from "./landing/Hero";
import { Problem } from "./landing/Problem";
import { Loop } from "./landing/Loop";
import { Aspects } from "./landing/Aspects";
import { Proof } from "./landing/Proof";
import { Closing } from "./landing/Closing";

export default function Landing() {
  return (
    <>
      <PublicNav />
      <main>
        <Hero />
        <Problem />
        <Loop />
        <Aspects />
        <Proof />
        <Closing />
      </main>
    </>
  );
}
