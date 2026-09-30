"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopNav } from "@/components/layout/top-nav";
import { Footer } from "@/components/layout/footer";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/input";
import { ColorBlock } from "@/components/ui/color-block";
import { computeProof, deriveRoomKey, exportRoomKey } from "@/lib/crypto/room";
import { randomB64 } from "@/lib/crypto/base64";
import { ulid } from "@/lib/utils/id";
import { IDENTITY_COLORS, onColor } from "@/lib/utils/color";
import { useSessionStore } from "@/stores/session";
import { cn } from "@/lib/utils/cn";

type Mode = "create" | "join";

function extractRoomId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const fromUrl = url.searchParams.get("room");
    if (fromUrl) return fromUrl.trim();
  } catch {
    /* not a URL */
  }
  const match = trimmed.match(/[0-9A-HJKMNP-TV-Z]{26}/i);
  return match ? match[0] : trimmed;
}

export function JoinFlow() {
  const router = useRouter();
  const search = useSearchParams();
  const session = useSessionStore();

  const paramRoom = search.get("room") ?? "";
  const [mode, setMode] = useState<Mode>(paramRoom ? "join" : "create");
  const [roomRef, setRoomRef] = useState(paramRoom);
  const [roomName, setRoomName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(IDENTITY_COLORS[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    session.hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alreadyIn = useMemo(
    () => session.hydrated && session.roomId && session.roomKeyB64,
    [session.hydrated, session.roomId, session.roomKeyB64],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) return setError("Pick a display name.");
    if (passphrase.length < 8) return setError("Passphrase must be at least 8 characters.");

    setBusy(true);
    try {
      const deviceId = session.deviceId ?? ulid();
      session.setProfile({ name: trimmedName, color });

      let roomId = "";
      let effectiveRoomName = "";
      let salt = "";

      if (mode === "create") {
        if (passphrase !== confirm) {
          setBusy(false);
          return setError("Passphrases don't match.");
        }
        if (!roomName.trim()) {
          setBusy(false);
          return setError("Give the room a name.");
        }
        roomId = ulid();
        effectiveRoomName = roomName.trim();
        salt = randomB64(16);
        const key = await deriveRoomKey(passphrase, salt);
        const proof = await computeProof(key, roomId);
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId, name: effectiveRoomName, salt, proof }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? "Could not create the room.");
        }
        await finishJoin({ roomId, roomName: effectiveRoomName, salt, deviceId, key, proof });
        return;
      }

      roomId = extractRoomId(roomRef);
      if (!roomId) return setError("Paste the room link or ID you were given.");

      const metaRes = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/meta`);
      if (metaRes.status === 404) {
        setBusy(false);
        return setError("No room with that ID on this hub. Check the link.");
      }
      if (!metaRes.ok) {
        setBusy(false);
        return setError("Hub unreachable — is it running?");
      }
      const meta = (await metaRes.json()) as { name: string; salt: string };
      effectiveRoomName = meta.name;
      salt = meta.salt;
      const key = await deriveRoomKey(passphrase, salt);
      const proof = await computeProof(key, roomId);
      await finishJoin({ roomId, roomName: effectiveRoomName, salt, deviceId, key, proof });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function finishJoin(input: {
    roomId: string;
    roomName: string;
    salt: string;
    deviceId: string;
    key: CryptoKey;
    proof: string;
  }): Promise<void> {
    const profile = { name: name.trim(), color };
    const res = await fetch(`/api/rooms/${encodeURIComponent(input.roomId)}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: input.deviceId,
        name: profile.name,
        color: profile.color,
        proof: input.proof,
      }),
    });
    if (res.status === 403) {
      throw new Error("Wrong passphrase for this room.");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message ?? "Could not join the room.");
    }
    const { token } = (await res.json()) as { token: string };

    if (!useSessionStore.getState().deviceId) {
      useSessionStore.getState().ensureDevice(profile.name, profile.color);
    } else {
      useSessionStore.getState().setProfile(profile);
    }
    useSessionStore.getState().enterRoom({
      roomId: input.roomId,
      roomName: input.roomName,
      token,
      roomKeyB64: await exportRoomKey(input.key),
      cursor: 0,
    });
    router.push("/chat");
  }

  return (
    <>
      <TopNav />
      <section className="mx-auto w-full max-w-[1280px] flex-1 px-6 py-section lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col items-start gap-5">
            <Eyebrow className="text-ink">Room access</Eyebrow>
            <h1 className="text-display-lg max-w-[14ch]">
              {mode === "create" ? "Start a room." : "Join the mesh."}
            </h1>
            <p className="text-body-lg max-w-[44ch]">
              One passphrase protects the room&apos;s content on the hub — the
              server never learns it. No accounts, no emails, nothing leaves
              your local network.
            </p>
          </div>

          <ColorBlock color={mode === "create" ? "lime" : "lilac"}>
            {alreadyIn ? (
              <div className="flex flex-col items-start gap-5">
                <Eyebrow className="text-ink">Already unlocked</Eyebrow>
                <p className="text-subhead">
                  You&apos;re in <strong className="font-540">{session.roomName}</strong>.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => router.push("/chat")}>Open the app</Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      session.reset();
                      setMode("create");
                      setRoomRef("");
                    }}
                  >
                    Leave room
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-5">
                <div className="flex gap-1.5" role="tablist" aria-label="Room mode">
                  {(["create", "join"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={mode === value}
                      onClick={() => {
                        setMode(value);
                        setError(null);
                      }}
                      className={cn(
                        "min-h-[44px] rounded-pill px-4 py-1.5 text-button-sm font-medium transition-colors",
                        mode === value
                          ? "bg-primary text-on-primary"
                          : "bg-canvas text-ink",
                      )}
                    >
                      {value === "create" ? "Create room" : "Join room"}
                    </button>
                  ))}
                </div>

                {mode === "create" ? (
                  <Field label="Room name">
                    <TextInput
                      value={roomName}
                      onChange={(e) => setRoomName(e.target.value)}
                      placeholder="Base camp · Sector 4"
                      maxLength={80}
                      autoComplete="off"
                    />
                  </Field>
                ) : (
                  <Field label="Room link or ID" hint="Shared by whoever started the hub.">
                    <TextInput
                      value={roomRef}
                      onChange={(e) => setRoomRef(e.target.value)}
                      placeholder="http://192.168.1.20:3000/join?room=…"
                      autoComplete="off"
                    />
                  </Field>
                )}

                <Field label="Display name">
                  <TextInput
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Maya"
                    maxLength={40}
                    autoComplete="off"
                  />
                </Field>

                <Field
                  label="Passphrase"
                  hint={mode === "create" ? "Minimum 8 characters. Lost = unreadable room." : undefined}
                >
                  <TextInput
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </Field>

                {mode === "create" ? (
                  <Field label="Repeat passphrase">
                    <TextInput
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </Field>
                ) : null}

                <fieldset className="flex flex-col gap-2">
                  <legend className="caption mb-2 text-ink">Identity color</legend>
                  <div className="flex flex-wrap gap-2">
                    {IDENTITY_COLORS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-label={`Color ${value}`}
                        aria-pressed={color === value}
                        onClick={() => setColor(value)}
                        className={cn(
                          "size-10 rounded-full border-2 transition-transform",
                          color === value ? "border-ink scale-110" : "border-transparent",
                        )}
                        style={{ backgroundColor: value, color: onColor(value) }}
                      >
                        <span aria-hidden="true">{color === value ? "✓" : ""}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                {error ? (
                  <div
                    role="alert"
                    className="rounded-md bg-block-pink px-4 py-3 text-body-sm font-330 text-ink"
                  >
                    {error}
                  </div>
                ) : null}

                <div className="mt-1 flex flex-wrap gap-3">
                  <Button type="submit" size="lg" disabled={busy}>
                    {busy
                      ? "Working…"
                      : mode === "create"
                        ? "Create room"
                        : "Join room"}
                  </Button>
                </div>
              </form>
            )}
          </ColorBlock>
        </div>
      </section>
      <Footer />
    </>
  );
}

export function JoinPageClient() {
  return (
    <Suspense fallback={null}>
      <JoinFlow />
    </Suspense>
  );
}
