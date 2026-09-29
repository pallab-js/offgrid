import type { Metadata } from "next";
import { PageStub } from "@/components/layout/page-stub";
import { TopNav } from "@/components/layout/top-nav";
import { Footer } from "@/components/layout/footer";

export const metadata: Metadata = { title: "Join a room" };

export default function JoinPage() {
  return (
    <>
      <TopNav />
      <section className="mx-auto w-full max-w-[1280px] flex-1 px-6 py-section lg:px-8">
        <PageStub
          phase="Phase 1"
          title="Create or join a room"
          blurb="Room creation, passphrase derivation and the join flow land in Phase 1 — one screen, one passphrase, no accounts."
        />
      </section>
      <Footer />
    </>
  );
}
