"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Eye, EyeOff, LogOut, Shield, Trash2, UserMinus, AlertTriangle } from "lucide-react";
import { useSessionStore } from "@/stores/session";
import { useMeshStore } from "@/stores/mesh";
import { resetRoomStores } from "@/stores/reset";
import { revokeOwnToken, revokeDeviceToken } from "@/lib/session/token";
import { clearJoinNotices, postRoomJoin, rotateRoom, setRoomModerator } from "@/lib/session/api";
import { computeProof, deriveRoomKey, exportRoomKey, seal, unwrapKeyHistory } from "@/lib/crypto/room";
import { randomB64 } from "@/lib/crypto/base64";
import type { Peer } from "@/lib/protocol";
import { IDENTITY_COLORS, onColor } from "@/lib/utils/color";
import { buildJoinUrl } from "@/lib/utils/invite";
import { downloadExport, wipeLocalData } from "@/lib/data/export";
import { manualCompaction } from "@/lib/sync/compaction";
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
  const deviceId = useSessionStore((s) => s.deviceId);
  const moderators = useSessionStore((s) => s.moderators);
  const router = useRouter();

  const [exporting, setExporting] = useState(false);
  const [wipeText, setWipeText] = useState("");
  const [wiping, setWiping] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [freeingSpace, setFreeingSpace] = useState(false);

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

  async function onFreeSpace(): Promise<void> {
    setFreeingSpace(true);
    try {
      const { messagesDeleted, fileBlobsCleared } = await manualCompaction();
      toast(`Freed space: ${messagesDeleted} old messages removed, ${fileBlobsCleared} large file caches cleared`);
    } catch {
      toast("Cleanup failed — try again", "error");
    } finally {
      setFreeingSpace(false);
    }
  }

  function onLeave(): void {
    setLeaving(true);
    revokeOwnToken(); // before session state clears — fire-and-forget
    resetRoomStores();
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

      {hasRoom && roomId && deviceId && moderators.includes(deviceId) ? (
        <ModerationSection roomId={roomId} />
      ) : null}

      {hasRoom && roomId ? <PassphraseSection roomId={roomId} /> : null}

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

      <section className="flex flex-col gap-4 rounded-xl border border-hairline bg-canvas p-5">
        <h2 className="text-card-title">Storage</h2>
        <p className="text-body-sm">
          Clears message history older than 30 days and removes cached file blobs
          larger than 32 MB. Recent messages and small files stay available offline.
        </p>
        <div>
          <Button variant="secondary" onClick={() => void onFreeSpace()} disabled={freeingSpace}>
            <Trash2 className="size-4" aria-hidden="true" />
            {freeingSpace ? "Cleaning up…" : "Free up space"}
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
  const profile = useSessionStore((s) => s.profile);
  const setProfile = useSessionStore((s) => s.setProfile);
  const setManualBattery = useSessionStore((s) => s.setManualBattery);
  const ensureDevice = useSessionStore((s) => s.ensureDevice);
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const [manualBattery, setManualBatteryState] = useState(profile?.manualBattery ?? "");

  function saveProfile(): void {
    const trimmed = name.trim() || "Explorer";
    if (deviceId) setProfile({ name: trimmed, color, manualBattery: manualBattery === "" ? null : Number(manualBattery) });
    else ensureDevice(trimmed, color);
    if (manualBattery !== "") setManualBattery(manualBattery === "" ? null : Number(manualBattery));
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
      <label className="flex flex-col gap-1.5">
        <span className="caption text-ink">Manual battery % (for devices without Battery API)</span>
        <TextInput
          type="number"
          min={0}
          max={100}
          value={manualBattery}
          onChange={(e) => setManualBatteryState(e.target.value)}
          placeholder="e.g. 85"
          aria-label="Manual battery percentage"
          className="max-w-[120px]"
        />
        <span className="caption text-ink">Leave empty to use device battery API (if available)</span>
      </label>
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

/**
 * Moderator tools: promote/demote devices, revoke a lost device's access
 * (kills its live session too), bulk-clear join notices. Server enforces
 * every action — the hub rejects non-moderators with NOT_MODERATOR; this
 * UI only appears because the hub said this device is a moderator.
 */
function ModerationSection({ roomId }: { roomId: string }) {
  const peers = useMeshStore((s) => s.peers);
  const deviceId = useSessionStore((s) => s.deviceId);
  const moderators = useSessionStore((s) => s.moderators);
  const setModerators = useSessionStore((s) => s.setModerators);
  const [busyDevice, setBusyDevice] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  async function toggleMod(peer: Peer): Promise<void> {
    setBusyDevice(peer.deviceId);
    try {
      const next = await setRoomModerator(roomId, peer.deviceId, !moderators.includes(peer.deviceId));
      setModerators(next);
      toast(moderators.includes(peer.deviceId) ? `${peer.name} is no longer a moderator` : `${peer.name} is now a moderator`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update moderators", "error");
    } finally {
      setBusyDevice(null);
    }
  }

  async function revokeAccess(peer: Peer): Promise<void> {
    setBusyDevice(peer.deviceId);
    try {
      const tokens = await revokeDeviceToken(peer.deviceId);
      if (tokens === null) throw new Error("Could not revoke access — try again");
      toast(`${peer.name} lost access — they need the (new) passphrase to rejoin`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not revoke access", "error");
    } finally {
      setBusyDevice(null);
    }
  }

  async function onClearNotices(): Promise<void> {
    setClearing(true);
    try {
      const cleared = await clearJoinNotices(roomId);
      toast(cleared === 0 ? "No join notices to clear" : `Cleared ${cleared} join notice${cleared === 1 ? "" : "s"}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not clear join notices", "error");
    } finally {
      setClearing(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-hairline bg-canvas p-5">
      <h2 className="text-card-title">Moderation</h2>
      <p className="text-body-sm">
        Moderators can delete any member&apos;s message, remove a lost
        device&apos;s access, and clear join notices. Everyone with the
        passphrase is still equal — moderation is a convenience, not a
        hierarchy: a passphrase holder can always rejoin.
      </p>

      <ul className="flex flex-col divide-y divide-hairline">
        {peers.map((peer) => {
          const isSelf = peer.deviceId === deviceId;
          const isMod = moderators.includes(peer.deviceId);
          return (
            <li key={peer.deviceId} className="flex flex-wrap items-center gap-3 py-2">
              <span
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full caption"
                style={{ backgroundColor: peer.color, color: onColor(peer.color) }}
                aria-hidden="true"
              >
                {peer.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="text-body-sm">{peer.name}</span>
              {isMod ? <Pill tone="soft">mod</Pill> : null}
              {!peer.online ? <span className="caption text-ink">offline</span> : null}
              <span className="ml-auto flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={busyDevice === peer.deviceId}
                  onClick={() => void toggleMod(peer)}
                >
                  <Shield className="size-4" aria-hidden="true" />
                  {isSelf ? "Step down" : isMod ? "Revoke mod" : "Make mod"}
                </Button>
                {isSelf ? null : (
                  <Button
                    variant="secondary"
                    disabled={busyDevice === peer.deviceId}
                    onClick={() => void revokeAccess(peer)}
                  >
                    <UserMinus className="size-4" aria-hidden="true" />
                    Revoke access
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={clearing} onClick={() => void onClearNotices()}>
          <Trash2 className="size-4" aria-hidden="true" />
          {clearing ? "Clearing…" : "Clear join notices"}
        </Button>
        <span className="caption text-ink">
          Removes every &quot;joined&quot; notice in one action — the only way
          system messages ever leave the room.
        </span>
      </div>
    </section>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  show,
  onToggleShow,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  show: boolean;
  onToggleShow: () => void;
  autoComplete: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="caption text-ink">{label}</span>
      <div className="relative">
        <TextInput
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          autoComplete={autoComplete}
          className="max-w-[320px] pr-12"
        />
        <button
          type="button"
          onClick={onToggleShow}
          aria-label={show ? "Hide passphrase" : "Show passphrase"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink hover:text-ink/60"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </label>
  );
}

/**
 * Passphrase rotation (TRD §9.13): swaps the room's salt+proof, wraps the
 * previous room key under the new one so history stays readable, and revokes
 * every token in the room — all other devices must rejoin with the new
 * passphrase. Anyone holding the current passphrase may rotate; the hub
 * authorizes with a proof of the *current* passphrase, not a token.
 */
function PassphraseSection({ roomId }: { roomId: string }) {
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingRotation, setPendingRotation] = useState<{
    oldProof: string;
    newSalt: string;
    newProof: string;
    prevKey: { ct: string; iv: string };
    newKey: CryptoKey;
    deviceId: string;
    profile: { name: string; color: string };
  } | null>(null);

  async function prepareRotation(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (newPass.length < 8) return setError("New passphrase must be at least 8 characters.");
    if (newPass !== confirmPass) return setError("New passphrases do not match.");

    const session = useSessionStore.getState();
    const deviceId = session.deviceId;
    const profile = session.profile;
    if (!deviceId || !profile) return setError("No device identity on this session.");

    // Current salt comes from the hub — the client never persists it.
    const metaRes = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/meta`);
    if (!metaRes.ok) return setError("Room not reachable — is the hub up?");
    const meta = (await metaRes.json()) as { salt: string };

    const oldKey = await deriveRoomKey(currentPass, meta.salt);
    // Instant local feedback; the hub's timing-safe proof check is the
    // authoritative gate and also covers a rotation that happened while
    // this device was away (stale cached key).
    if (session.roomKeyB64 && (await exportRoomKey(oldKey)) !== session.roomKeyB64) {
      return setError("Current passphrase is wrong (the room may have been rotated).");
    }
    const oldProof = await computeProof(oldKey, roomId);

    const newSalt = randomB64(16);
    const newKey = await deriveRoomKey(newPass, newSalt);
    const newProof = await computeProof(newKey, roomId);
    // Wrap the previous key under the new one — the hub stores it blindly;
    // only holders of the new passphrase can unwrap it.
    const prevKey = await seal(newKey, await exportRoomKey(oldKey));

    // Store rotation data and show confirmation modal
    setPendingRotation({
      oldProof,
      newSalt,
      newProof,
      prevKey,
      newKey,
      deviceId,
      profile,
    });
    setShowConfirmModal(true);
  }

  async function executeRotation(): Promise<void> {
    const rotation = pendingRotation;
    if (!rotation) return;
    setShowConfirmModal(false);
    setBusy(true);
    try {
      await rotateRoom(roomId, {
        oldProof: rotation.oldProof,
        salt: rotation.newSalt,
        proof: rotation.newProof,
        prevKey: rotation.prevKey,
      });

      // Rotation revoked every token (ours included) — rejoin immediately
      // with the new proof; the socket restarts on the token change.
      const { token, moderators, keyHistory } = await postRoomJoin(roomId, {
        deviceId: rotation.deviceId,
        name: rotation.profile.name,
        color: rotation.profile.color,
        proof: rotation.newProof,
      });
      const session = useSessionStore.getState();
      session.enterRoom({
        roomId,
        roomName: session.roomName ?? "",
        token,
        roomKeyB64: await exportRoomKey(rotation.newKey),
        moderators,
        prevRoomKeysB64: await unwrapKeyHistory(rotation.newKey, keyHistory),
        cursor: session.cursor,
      });

      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
      setShowCurrent(false);
      setShowNew(false);
      setShowConfirm(false);
      toast("Passphrase changed — every other device must rejoin with the new one");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the passphrase.");
    } finally {
      setBusy(false);
      setPendingRotation(null);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-hairline bg-canvas p-5">
      <h2 className="text-card-title">Passphrase</h2>
      <p className="text-body-sm">
        Rotating the passphrase closes the room to everyone who knows the old
        one: all sessions are revoked and teammates must rejoin with the new
        passphrase. Existing messages stay readable — the old room key is
        re-wrapped under the new one — but anyone who already had the old
        passphrase may have copied them.
      </p>
      <form onSubmit={(e) => void prepareRotation(e)} className="flex flex-col gap-3">
        <PasswordField
          label="Current passphrase"
          value={currentPass}
          onChange={setCurrentPass}
          placeholder="Today's passphrase"
          show={showCurrent}
          onToggleShow={() => setShowCurrent((s) => !s)}
          autoComplete="off"
        />
        <PasswordField
          label="New passphrase"
          value={newPass}
          onChange={setNewPass}
          placeholder="At least 8 characters"
          show={showNew}
          onToggleShow={() => setShowNew((s) => !s)}
          autoComplete="off"
        />
        <PasswordField
          label="Confirm new passphrase"
          value={confirmPass}
          onChange={setConfirmPass}
          placeholder="Repeat it"
          show={showConfirm}
          onToggleShow={() => setShowConfirm((s) => !s)}
          autoComplete="off"
        />
        {error ? (
          <p role="alert" className="text-body-sm text-accent-magenta">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="magenta" disabled={busy || showConfirmModal}>
            {busy ? "Rotating…" : "Rotate passphrase"}
          </Button>
        </div>
      </form>

      {showConfirmModal && pendingRotation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-rotation-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay-scrim/70 p-4"
          onClick={() => setShowConfirmModal(false)}
        >
          <div
            className="flex max-w-[480px] flex-col gap-4 rounded-xl bg-canvas p-5 shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="size-5 text-accent-magenta shrink-0" aria-hidden="true" />
              <h3 id="confirm-rotation-title" className="text-card-title">
                Confirm passphrase rotation
              </h3>
            </div>
            <p className="text-body-sm">
              This action will <strong>immediately revoke access for every device in the room</strong>,
              including yours. Everyone will need to rejoin with the new passphrase.
            </p>
            <ul className="flex flex-col gap-1.5 text-body-sm text-ink/80">
              <li>• All active sessions will be disconnected</li>
              <li>• Messages and files stay readable (old key is re-wrapped)</li>
              <li>• Anyone with the old passphrase may have already copied content</li>
              <li>• This action cannot be undone</li>
            </ul>
            <div className="flex flex-wrap gap-3 justify-end pt-2">
              <Button variant="secondary" onClick={() => setShowConfirmModal(false)}>
                Cancel
              </Button>
              <Button variant="magenta" onClick={() => void executeRotation()} disabled={busy}>
                {busy ? "Rotating…" : "Yes, rotate passphrase"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
