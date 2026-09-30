"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, LogOut, Trash2 } from "lucide-react";
import { useSessionStore } from "@/stores/session";
import { IDENTITY_COLORS, onColor } from "@/lib/utils/color";
import { buildJoinUrl } from "@/lib/utils/invite";
import { downloadExport, wipeLocalData } from "@/lib/data/export";
import { toast } from "@/stores/toast";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { TextInput } from "@/components/ui/input";
import { InvitePanel } from "@/components/invite/invite-panel";
import { cn } from "@/lib/utils/cn";

const WIPE_PHRASE = "WIPE";

function subscribeOrigin(): () => void {
  return () => {};
}

function readServerOrigin(): string {
  return "";
}

export function SettingsPage() {
  const hasRoom = useSessionStore((s) => Boolean(s.roomId));
  const roomName = useSessionStore((s) => s.roomName);
  const roomId = useSessionStore((s) => s.roomId);
  const profile = useSessionStore((s) => s.profile);
  const leaveRoom = useSessionStore((s) => s.leaveRoom);
  const router = useRouter();

  const [exporting, setExporting] = useState(false);
  const [wipeText, setWipeText] = useState("");
  const [wiping, setWiping] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function onExport(): Promise<void> {
    setExporting(true);
    try {
      await downloadExport();
      toast("Export downloaded");
    } catch {
      toast("Export failed — could not read local data", "error");
    } finally {
      setExporting(false);
    }
  }

  function onLeave(): void {
    setLeaving(true);
    leaveRoom();
    router.push("/");
  }

  async function onWipe(): Promise<void> {
    setWiping(true);
    try {
      await wipeLocalData();
    } catch {
      toast("Wipe failed — try again", "error");
      setWiping(false);
    }
  }

  const canWipe = wipeText.trim().toUpperCase() === WIPE_PHRASE;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Eyebrow className="text-ink">Settings</Eyebrow>
        <h1 className="text-display-lg">Profile &amp; data</h1>
      </header>

      <ProfileForm
        key={`${profile?.name ?? ""}:${profile?.color ?? ""}`}
        initialName={profile?.name ?? ""}
        initialColor={profile?.color ?? IDENTITY_COLORS[0]}
      />

      <section className="flex flex-col gap-4 rounded-xl border border-hairline bg-canvas p-5">
        <h2 className="text-card-title">Room</h2>
        {hasRoom ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Pill tone="soft">{roomName}</Pill>
              <span className="caption text-ink">id {roomId}</span>
            </div>
            <p className="text-body-sm">
              Leaving keeps this device&apos;s data but forgets the room, token
              and cached key. Rejoin with the passphrase to return.
            </p>
            <div>
              <Button variant="secondary" onClick={onLeave} disabled={leaving}>
                <LogOut className="size-4" aria-hidden="true" />
                {leaving ? "Leaving…" : "Leave room"}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-body-sm">No room on this device yet.</p>
            <Link
              href="/join"
              className="inline-flex min-h-[44px] items-center rounded-pill border border-hairline px-5 py-2 text-button font-medium text-ink hover:border-ink/40"
            >
              Set up a room
            </Link>
          </div>
        )}
      </section>

      {hasRoom && roomId ? (
        <InviteSection roomName={roomName ?? ""} roomId={roomId} />
      ) : null}

      <section className="flex flex-col gap-4 rounded-xl border border-hairline bg-canvas p-5">
        <h2 className="text-card-title">Export</h2>
        <p className="text-body-sm">
          Downloads everything stored locally as JSON — messages, notes,
          waypoints, checklist progress and SOS history. Content is plaintext
          while the room key is unlocked, ciphertext otherwise. File bytes stay
          on this device.
        </p>
        <div>
          <Button variant="secondary" onClick={() => void onExport()} disabled={exporting}>
            <Download className="size-4" aria-hidden="true" />
            {exporting ? "Building export…" : "Export JSON"}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-accent-magenta bg-canvas p-5">
        <h2 className="text-card-title">Danger zone</h2>
        <p className="text-body-sm">
          Wipes this device clean: profile, room membership, cached key and
          every local record. The server keeps its copy — ask the hub operator
          to clear the database too.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="caption text-ink">
            Type {WIPE_PHRASE} to confirm
          </span>
          <TextInput
            value={wipeText}
            onChange={(e) => setWipeText(e.target.value)}
            placeholder={WIPE_PHRASE}
            aria-label={`Type ${WIPE_PHRASE} to confirm wipe`}
            className="max-w-[240px]"
          />
        </label>
        <div>
          <Button variant="magenta" disabled={!canWipe || wiping} onClick={() => void onWipe()}>
            <Trash2 className="size-4" aria-hidden="true" />
            {wiping ? "Wiping…" : "Wipe local data"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ProfileForm({
  initialName,
  initialColor,
}: {
  initialName: string;
  initialColor: string;
}) {
  const deviceId = useSessionStore((s) => s.deviceId);
  const setProfile = useSessionStore((s) => s.setProfile);
  const ensureDevice = useSessionStore((s) => s.ensureDevice);
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);

  function saveProfile(): void {
    const trimmed = name.trim() || "Explorer";
    if (deviceId) setProfile({ name: trimmed, color });
    else ensureDevice(trimmed, color);
    toast("Profile saved");
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-hairline bg-canvas p-5">
      <h2 className="text-card-title">Profile</h2>
      <p className="text-body-sm">
        Your name and color show up in presence, messages and the status
        board for everyone in the room.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="caption text-ink">Display name</span>
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 32))}
          placeholder="Your name"
          aria-label="Display name"
        />
      </label>
      <fieldset>
        <legend className="caption mb-2 text-ink">Identity color</legend>
        <div className="flex flex-wrap gap-2">
          {IDENTITY_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Color ${swatch}`}
              aria-pressed={color === swatch}
              onClick={() => setColor(swatch)}
              className={cn(
                "size-10 rounded-full border-2 transition-transform",
                color === swatch ? "border-ink scale-110" : "border-hairline",
              )}
              style={{ backgroundColor: swatch, color: onColor(swatch) }}
            />
          ))}
        </div>
      </fieldset>
      <div>
        <Button onClick={saveProfile}>Save profile</Button>
      </div>
    </section>
  );
}

function InviteSection({ roomName, roomId }: { roomName: string; roomId: string }) {
  const joinUrl = useSyncExternalStore(
    subscribeOrigin,
    () => buildJoinUrl(window.location.origin, roomId),
    readServerOrigin,
  );

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-hairline bg-canvas p-5">
      <h2 className="text-card-title">Invite</h2>
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone="soft">{roomName}</Pill>
        <span className="caption text-ink">id {roomId}</span>
      </div>
      <p className="text-body-sm">
        Scan or copy the link — teammates open it, pick a name and enter the
        passphrase themselves. The code carries no secrets.
      </p>
      {joinUrl ? <InvitePanel url={joinUrl} /> : null}
    </section>
  );
}
