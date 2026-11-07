"use client";
import { Camera, Lock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { removeMyAvatar, setMyAvatar, updateMyProfile } from "@/lib/data/social";
import {
  AVATAR_MAX_UPLOAD_BYTES, AVATAR_SIZE_PX, avatarFileProblem, centreSquare, INTERESTS, MAX_BIO, MAX_INTERESTS, validateProfile,
} from "@/lib/domain/social";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Avatar } from "./common";

/**
 * Re-encode a photo in the browser as a small square WebP (JPEG where WebP isn't supported). This also
 * drops every embedded metadata field, including location, before anything is uploaded.
 */
async function toAvatarBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions).catch(() => null);
  if (!bitmap) throw new Error("This photo can't be read. Try a JPEG or PNG.");
  const { sx, sy, side } = centreSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare the photo.");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
  bitmap.close?.();
  for (const [type, q] of [["image/webp", 0.86], ["image/webp", 0.7], ["image/jpeg", 0.85], ["image/jpeg", 0.7]] as const) {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
    if (blob && blob.type === type && blob.size <= AVATAR_MAX_UPLOAD_BYTES) return blob;
  }
  throw new Error("Couldn't make this photo small enough. Try another one.");
}

export function EditProfile({ me, initial }: {
  me: string;
  initial: { displayName: string; bio: string; interests: string[]; avatarPath: string | null; avatarVersion: string | null };
}) {
  const router = useRouter();
  const [f, setF] = useState({ displayName: initial.displayName, bio: initial.bio, interests: initial.interests });
  const [avatarPath, setAvatarPath] = useState(initial.avatarPath);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "photo">(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const problem = validateProfile(f);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function pick(file: File | undefined) {
    if (!file) return;
    const p = avatarFileProblem(file.type, file.size);
    if (p) { toast.error(p); return; }
    setBusy("photo");
    try {
      const blob = await toAvatarBlob(file);
      const path = await setMyAvatar(createClient(), blob, avatarPath);
      setAvatarPath(path);
      setPreview(URL.createObjectURL(blob));
      toast.success("Photo updated");
      router.refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); if (fileInput.current) fileInput.current.value = ""; }
  }

  async function save() {
    if (problem) { toast.error(problem); return; }
    setBusy("save");
    try {
      await updateMyProfile(createClient(), f);
      toast.success("Profile saved");
      router.push("/community/me");
      router.refresh();
    } catch (e) { toast.error((e as Error).message); setBusy(null); }
  }

  const toggle = (v: string) => setF((x) => ({
    ...x, interests: x.interests.includes(v) ? x.interests.filter((i) => i !== v) : x.interests.length >= MAX_INTERESTS ? x.interests : [...x.interests, v],
  }));

  return (
    <div className="mx-auto max-w-[600px] space-y-6">
      <section className="flex items-center gap-4">
        <Avatar name={f.displayName || "?"} id={me} photo={avatarPath ? initial.avatarVersion ?? "new" : null} src={preview} className="size-20 text-[26px]" />
        <div className="flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" aria-label="Choose a profile photo"
            onChange={(e) => pick(e.target.files?.[0])} />
          <Button variant="secondary" className="h-10" disabled={!!busy} onClick={() => fileInput.current?.click()}><Camera /> {busy === "photo" ? "Uploading…" : avatarPath ? "Change photo" : "Add photo"}</Button>
          {avatarPath && (
            <Button variant="quiet" className="h-10" disabled={!!busy} onClick={async () => {
              setBusy("photo");
              try { await removeMyAvatar(createClient(), avatarPath); setAvatarPath(null); setPreview(null); toast.success("Photo removed"); router.refresh(); }
              catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
            }}><Trash2 /> Remove</Button>
          )}
        </div>
      </section>

      <Field label="Display name">
        <Input value={f.displayName} maxLength={60} autoComplete="nickname" onChange={(e) => setF({ ...f, displayName: e.target.value })} />
      </Field>

      <Field label="Bio (optional)" hint={`${f.bio.trim().length}/${MAX_BIO}`}>
        <Textarea value={f.bio} maxLength={MAX_BIO} rows={3} placeholder="e.g. Early-morning lifter, learning to deadlift" onChange={(e) => setF({ ...f, bio: e.target.value })} />
      </Field>

      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-muted-foreground">Training interests · up to {MAX_INTERESTS}</legend>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((i) => {
            const on = f.interests.includes(i.value);
            const full = !on && f.interests.length >= MAX_INTERESTS;
            return (
              <button key={i.value} type="button" aria-pressed={on} disabled={full} onClick={() => toggle(i.value)}
                className={cn("h-10 rounded-full border px-3.5 text-[14px] font-medium transition-colors active:scale-[0.97] disabled:opacity-40",
                  on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
                {i.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <section aria-labelledby="who-h" className="flex gap-3 rounded-lg bg-subtle/60 p-3.5 text-[13.5px]">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <h2 id="who-h" className="font-semibold">Who sees your profile</h2>
          <p className="mt-0.5 text-muted-foreground">
            Friends, people you have a request or conversation with, members of your gym who can find you, and people who can see your posts or comments.
            Your gym shows only to its members, and only while <Link href="/community/gym" className="font-semibold text-foreground underline-offset-2 hover:underline">Let people here find me</Link> is on.
            Your workouts, body measurements and energy ratings are never shown.
          </p>
        </div>
      </section>

      <div className="flex gap-2">
        <Button variant="primary" size="lg" className="flex-1" disabled={!!busy || !!problem} onClick={save}>{busy === "save" ? "Saving…" : "Save profile"}</Button>
        <Button asChild variant="ghost" size="lg"><Link href="/community/me">Cancel</Link></Button>
      </div>
    </div>
  );
}
