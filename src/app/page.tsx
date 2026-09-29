import Link from "next/link";
import {
  RadioTower,
  Files,
  Siren,
  MapPinned,
  ListChecks,
  Waves,
  NotebookPen,
  BatteryCharging,
  ArrowRight,
} from "lucide-react";
import { TopNav } from "@/components/layout/top-nav";
import { MarqueeStrip } from "@/components/layout/marquee-strip";
import { Footer } from "@/components/layout/footer";
import { ColorBlock } from "@/components/ui/color-block";
import { Eyebrow, Caption } from "@/components/ui/eyebrow";
import { ButtonLink } from "@/components/ui/button-link";
import { Pill } from "@/components/ui/pill";

const FEATURES = [
  {
    icon: RadioTower,
    title: "Messaging that syncs itself",
    body: "Channels, replies and delivery states over the local network. Compose offline — the queue sends the moment the hub is back.",
  },
  {
    icon: Files,
    title: "Files on the mesh",
    body: "Stream documents, maps and media straight to the hub with live progress. Interrupted downloads pick up where they stopped.",
  },
  {
    icon: Siren,
    title: "Survival tools, built in",
    body: "Distress beacon, offline map, checklists, morse signaling, shared journal and a team status board — no installs, no app store.",
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Start the hub",
    body: "One machine runs OffGrid — a laptop, a mini PC, anything on the local network. That machine is the whole infrastructure.",
  },
  {
    n: "02",
    title: "Share the link",
    body: "Teammates open the URL in any browser and enter the room passphrase once. No accounts, no emails, no downloads.",
  },
  {
    n: "03",
    title: "Work through anything",
    body: "Messages, files and plans stay live while the internet doesn't. If the hub hiccups, every device keeps its history and queue.",
  },
] as const;

const FIELD_TOOLS = [
  {
    icon: Siren,
    title: "SOS beacon",
    body: "One tap flashes and sounds an alert on every connected device until someone clears it.",
  },
  {
    icon: MapPinned,
    title: "Offline map",
    body: "Calibrate a map image, drop waypoints, share coordinates — zero internet map tiles.",
  },
  {
    icon: ListChecks,
    title: "Checklists & guides",
    body: "Evacuation, water, first-aid basics and signaling — bundled, searchable, synced per room.",
  },
  {
    icon: Waves,
    title: "Morse signaling",
    body: "Encode any message, transmit it with audio and full-screen light, replay it on a peer's device.",
  },
  {
    icon: NotebookPen,
    title: "Shared notes",
    body: "An encrypted group journal for rosters, plans and inventory that everyone can edit.",
  },
  {
    icon: BatteryCharging,
    title: "Status board",
    body: "Battery, connection quality and last-seen for every teammate at a glance.",
  },
] as const;

export default function LandingPage() {
  return (
    <>
      <TopNav />
      <MarqueeStrip />

      {/* ---------------------------------------------------- Hero (white) */}
      <section className="mx-auto w-full max-w-[1280px] px-6 pt-16 pb-section lg:px-8 lg:pt-24">
        <div className="grid items-center gap-14 lg:grid-cols-[1.15fr_1fr]">
          <div className="flex flex-col items-start gap-7">
            <Eyebrow className="text-ink">Local mesh · No internet</Eyebrow>
            <h1 className="text-display-xl max-w-[13ch]">
              Talk when the grid goes quiet.
            </h1>
            <p className="text-body-lg max-w-[46ch]">
              OffGrid turns any machine on your network into a field hub —
              real-time messaging, file sharing and survival tooling for
              everyone nearby. No internet. No accounts. No cloud.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink href="/join" size="lg">
                Get started
              </ButtonLink>
              <ButtonLink href="/chat" variant="secondary" size="lg">
                Open app
              </ButtonLink>
            </div>
            <Caption className="text-ink">
              pnpm dev → share the URL → everyone joins
            </Caption>
          </div>

          {/* Sticky-note collage — pastel notes on a clean desk */}
          <div className="relative mx-auto h-[380px] w-full max-w-[440px]">
            <div className="absolute left-0 top-4 w-[62%] rotate-[-3deg] rounded-md bg-block-lime p-5 shadow-tile">
              <Caption className="text-ink">Waypoint shared</Caption>
              <p className="mt-2 text-body font-340">
                Ridge camp · 47.6062 N, 122.3321 W
              </p>
            </div>

            <div className="absolute right-2 top-0 rotate-[2.5deg] rounded-pill bg-block-coral px-4 py-2 shadow-tile">
              <span className="caption text-ink">SOS active · 2 min ago</span>
            </div>

            <div className="absolute bottom-2 right-0 w-[80%] rotate-[1.2deg] rounded-lg border border-hairline bg-canvas p-5 shadow-tile">
              <div className="flex items-center gap-2 border-b border-hairline-soft pb-3">
                <span className="size-2.5 rounded-full bg-primary" />
                <Caption className="text-ink"># logistics</Caption>
                <span className="ml-auto caption text-ink">2 online</span>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <ChatLine name="Maya" tone="bg-block-lilac">
                  Water cache is at the marked waypoint.
                </ChatLine>
                <ChatLine name="Dan" tone="bg-block-mint">
                  Copy. Uploading the route file now.
                </ChatLine>
                <ChatLine name="You" tone="bg-block-pink">
                  Received — queue is synced.
                </ChatLine>
              </div>
            </div>

            <div className="absolute bottom-16 left-2 -rotate-[1.5deg] rounded-pill bg-inverse-canvas px-4 py-2 shadow-tile">
              <span className="caption text-inverse-ink">
                hub · offline queue 0
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------- Features (white) */}
      <section id="features" className="border-t border-hairline-soft">
        <div className="mx-auto w-full max-w-[1280px] px-6 py-section lg:px-8">
          <div className="flex max-w-[60ch] flex-col gap-5">
            <Eyebrow className="text-ink">What you get</Eyebrow>
            <h2 className="text-display-lg">
              One app for the conversation, the files and the plan.
            </h2>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className="flex flex-col gap-4 rounded-md bg-surface-soft p-6"
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-canvas">
                  <feature.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="text-card-title">{feature.title}</h3>
                <p className="text-body">{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------- How it works (lime) */}
      <section id="how" className="mx-auto w-full max-w-[1280px] px-6 pb-section lg:px-8">
        <ColorBlock color="lime">
          <div className="flex max-w-[54ch] flex-col gap-5">
            <Eyebrow className="text-ink">How the hub works</Eyebrow>
            <h2 className="text-subhead">
              The internet gives you servers. The field gives you each other.
            </h2>
          </div>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} className="flex flex-col gap-3">
                <Caption className="text-ink">{step.n}</Caption>
                <h3 className="text-card-title">{step.title}</h3>
                <p className="text-body">{step.body}</p>
              </div>
            ))}
          </div>
        </ColorBlock>
      </section>

      {/* ------------------------------------------- Field tools (navy) */}
      <section
        id="field-tools"
        className="mx-auto w-full max-w-[1280px] px-6 pb-section lg:px-8"
      >
        <ColorBlock color="navy">
          <div className="flex max-w-[54ch] flex-col gap-5">
            <Eyebrow className="text-inverse-ink">Built for the field</Eyebrow>
            <h2 className="text-subhead text-inverse-ink">
              Six survival tools that ship in the same tab as your messages.
            </h2>
          </div>
          <div className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {FIELD_TOOLS.map((tool) => (
              <div key={tool.title} className="flex flex-col gap-2.5">
                <tool.icon className="size-6" aria-hidden="true" />
                <h3 className="text-card-title">{tool.title}</h3>
                <p className="text-body-sm text-inverse-ink">{tool.body}</p>
              </div>
            ))}
          </div>
        </ColorBlock>
      </section>

      {/* ---------------------------------------------- Files (coral) */}
      <section className="mx-auto w-full max-w-[1280px] px-6 pb-section lg:px-8">
        <ColorBlock color="coral">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="flex flex-col items-start gap-5">
              <Eyebrow className="text-ink">Files on the mesh</Eyebrow>
              <h2 className="text-subhead">
                Drop it here — the whole team has it before the kettle boils.
              </h2>
              <p className="text-body max-w-[48ch]">
                Uploads stream straight to the hub with live progress; big
                files up to 512 MB. Downloads resume if you drop out, previews
                render in the browser, and small files stay cached on your
                device for when the hub is unreachable.
              </p>
              <ButtonLink href="/files" variant="secondary">
                See the file library
                <ArrowRight className="size-4" aria-hidden="true" />
              </ButtonLink>
            </div>
            <div className="rounded-md border border-hairline bg-canvas p-6 shadow-tile">
              <div className="flex items-center justify-between border-b border-hairline-soft pb-4">
                <Caption className="text-ink">file-library</Caption>
                <Pill tone="success">synced</Pill>
              </div>
              <ul className="flex flex-col divide-y divide-hairline-soft">
                {[
                  ["route-approach.gpx", "24 KB"],
                  ["shelter-site-photos.zip", "18.4 MB"],
                  ["comms-frequency-sheet.pdf", "310 KB"],
                  ["valley-topo-scan.png", "42.1 MB"],
                ].map(([name, size]) => (
                  <li
                    key={name}
                    className="flex items-center justify-between gap-4 py-3.5"
                  >
                    <span className="truncate text-body-sm font-330">
                      {name}
                    </span>
                    <span className="caption shrink-0 text-ink">{size}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </ColorBlock>
      </section>

      {/* ------------------------------------------- Closing CTA (white) */}
      <section className="border-t border-hairline-soft">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col items-start gap-7 px-6 py-section lg:px-8">
          <Eyebrow className="text-ink">Ready when the grid isn&apos;t</Eyebrow>
          <h2 className="text-display-lg max-w-[16ch]">
            Set up the hub in one command.
          </h2>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/join" size="lg">
              Create a room
            </ButtonLink>
            <ButtonLink href="/chat" variant="secondary" size="lg">
              Open the app
            </ButtonLink>
          </div>
          <Link
            href="/join"
            className="text-link underline decoration-hairline underline-offset-4 hover:decoration-ink"
          >
            Join with a passphrase →
          </Link>
        </div>
      </section>

      <Footer />
    </>
  );
}

function ChatLine({
  name,
  tone,
  children,
}: {
  name: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`mt-1 size-6 shrink-0 rounded-full ${tone}`}
        aria-hidden="true"
      />
      <p className="text-body-sm">
        <span className="font-480">{name}</span>{" "}
        <span className="font-330">{children}</span>
      </p>
    </div>
  );
}
