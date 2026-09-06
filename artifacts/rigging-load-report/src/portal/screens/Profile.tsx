import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import { PALETTE, type ThemeMode } from "../lib/portalTheme";
import { type PortalData, type Profile as ProfileType } from "../lib/portalStorage";
import { searchSkills } from "../lib/skillLibrary";
import { useT } from "../../lib/i18n/I18nContext";

const LANGUAGE_PRESETS: Array<{ value: string; key: "portal.profile.lang.no" | "portal.profile.lang.en" | "portal.profile.lang.sv" | "portal.profile.lang.da" | "portal.profile.lang.de" | "portal.profile.lang.fr" | "portal.profile.lang.es" }> = [
  { value: "Norwegian", key: "portal.profile.lang.no" },
  { value: "English", key: "portal.profile.lang.en" },
  { value: "Swedish", key: "portal.profile.lang.sv" },
  { value: "Danish", key: "portal.profile.lang.da" },
  { value: "German", key: "portal.profile.lang.de" },
  { value: "French", key: "portal.profile.lang.fr" },
  { value: "Spanish", key: "portal.profile.lang.es" },
];

export function Profile({
  theme,
  data,
  setData,
}: {
  theme: ThemeMode;
  data: PortalData;
  setData: React.Dispatch<React.SetStateAction<PortalData>>;
}) {
  const c = PALETTE[theme];
  const t = useT();
  const { getToken } = useAuth();
  const [draft, setDraft] = useState<ProfileType>(data.profile);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(data.profile),
    [draft, data.profile],
  );

  // Re-sync the draft from upstream whenever the underlying profile changes
  // (e.g. Clerk auto-fill arrives after mount, or the user switches accounts).
  // Only adopt the upstream change when the draft still matches the previous
  // upstream snapshot — i.e. the user is not mid-edit — so we never clobber
  // unsaved input.
  const lastSyncedRef = useRef(data.profile);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (data.profile === lastSyncedRef.current) return;
    const draftMatchesPrev =
      JSON.stringify(draftRef.current) === JSON.stringify(lastSyncedRef.current);
    lastSyncedRef.current = data.profile;
    if (draftMatchesPrev) {
      setDraft(data.profile);
    }
  }, [data.profile]);

  function patch<K extends keyof ProfileType>(key: K, value: ProfileType[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function saveProfile(nextDraft: ProfileType) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    // We commit `draft` to local state only after the PUT succeeds.
    // Committing optimistically would set `dirty=false` and disable
    // the Save button — leaving the user no way to retry a failed
    // save without making another edit first.
    const baseUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
      "/";
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}api/portal/profile/me`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fullName: draft.fullName,
          phone: nextDraft.phone,
          email: nextDraft.email,
          primaryRole: nextDraft.primaryRole,
          city: nextDraft.city,
          insurance: nextDraft.insurance,
          languages: nextDraft.languages,
          dietaryRequirements: nextDraft.dietary,
          allergies: nextDraft.allergies,
          skills: nextDraft.skills,
          bankAccount: nextDraft.bankAccount,
          orgNumber: nextDraft.orgNumber,
          roomShare: nextDraft.roomShare,
          gender: nextDraft.gender,
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      // Commit to local state only on success so the button only
      // returns to its non-dirty resting state when the server
      // confirmed the write.
      setDraft(nextDraft);
      setData((prev) => ({ ...prev, profile: nextDraft }));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t("portal.profile.saveError"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    await saveProfile(draft);
  }

  async function preparePhoto(file: File): Promise<File> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("portal.profile.photo.processError"));
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error(t("portal.profile.photo.processError"))),
        "image/jpeg",
        0.86,
      ),
    );
    return new File([blob], "profile-photo.jpg", { type: "image/jpeg" });
  }

  async function savePhotoReference(photoObjectPath: string) {
    const baseUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
      "/";
    const token = await getToken();
    const response = await fetch(`${baseUrl}api/portal/profile/photo`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ photoObjectPath }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || t("portal.profile.photo.saveError"));
    }
    const next = { ...draft, photoObjectPath };
    setDraft(next);
    setData((prev) => ({
      ...prev,
      profile: { ...prev.profile, photoObjectPath },
    }));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }

  async function uploadPhoto(file: File) {
    if (photoBusy) return;
    setPhotoBusy(true);
    setSaveError(null);
    const baseUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
      "/";
    try {
      const prepared = await preparePhoto(file);
      const token = await getToken();
      const request = await fetch(`${baseUrl}api/portal/profile/photo/upload-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: prepared.name,
          size: prepared.size,
          contentType: prepared.type,
        }),
      });
      const payload = (await request.json()) as {
        uploadURL?: string;
        objectPath?: string;
        error?: string;
      };
      if (!request.ok || !payload.uploadURL || !payload.objectPath) {
        throw new Error(payload.error || t("portal.profile.photo.startError"));
      }
      const upload = await fetch(payload.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": prepared.type },
        body: prepared,
      });
      if (!upload.ok) throw new Error(t("portal.profile.photo.uploadError"));
      await savePhotoReference(payload.objectPath);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t("portal.profile.photo.uploadError"),
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, flex: 1 }}>
          {t("portal.profile.title")}
        </h1>
        {savedFlash ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: c.success,
              padding: "6px 10px",
              borderRadius: 8,
              background: c.cardBgSubtle,
              border: `1px solid ${c.border}`,
            }}
          >
            {t("portal.profile.saved")}
          </span>
        ) : null}
        {saveError ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#b42318",
              padding: "6px 10px",
              borderRadius: 8,
              background: "rgba(180, 35, 24, 0.10)",
              border: "1px solid rgba(180, 35, 24, 0.35)",
            }}
          >
            {saveError}
          </span>
        ) : null}
      </header>

      <Section theme={theme} title={t("portal.profile.section.personal")}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <ProfileAvatar
            name={draft.fullName}
            photoObjectPath={draft.photoObjectPath}
            size={88}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label
              style={{
                padding: "9px 13px",
                borderRadius: 9,
                background: c.accent,
                color: "#0b0b0b",
                fontSize: 13,
                fontWeight: 700,
                cursor: photoBusy ? "wait" : "pointer",
              }}
            >
              {photoBusy
                ? t("portal.profile.photo.uploading")
                : draft.photoObjectPath
                  ? t("portal.profile.photo.change")
                  : t("portal.profile.photo.add")}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={photoBusy}
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadPhoto(file);
                }}
              />
            </label>
            {draft.photoObjectPath ? (
              <button
                type="button"
                disabled={photoBusy}
                onClick={() => {
                  setPhotoBusy(true);
                  setSaveError(null);
                  void savePhotoReference("")
                    .catch((err: unknown) =>
                      setSaveError(
                        err instanceof Error
                          ? err.message
                          : t("portal.profile.photo.removeError"),
                      ),
                    )
                    .finally(() => setPhotoBusy(false));
                }}
                style={{
                  padding: "9px 13px",
                  borderRadius: 9,
                  border: `1px solid ${c.border}`,
                  background: "transparent",
                  color: c.text,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {t("portal.profile.photo.remove")}
              </button>
            ) : null}
          </div>
        </div>
        <Grid2>
          <Field theme={theme} label={t("portal.profile.field.fullName")}>
            <input
              type="text"
              value={draft.fullName}
              onChange={(e) => patch("fullName", e.target.value)}
              style={inputStyle(theme)}
              placeholder=""
            />
          </Field>
          <Field theme={theme} label={t("portal.profile.field.phone")}>
            <input
              type="tel"
              value={draft.phone}
              onChange={(e) => patch("phone", e.target.value)}
              style={inputStyle(theme)}
              placeholder=""
            />
          </Field>
          <Field theme={theme} label={t("portal.profile.field.email")}>
            <input
              type="email"
              value={draft.email}
              onChange={(e) => patch("email", e.target.value)}
              style={inputStyle(theme)}
              placeholder=""
            />
          </Field>
          <Field theme={theme} label={t("portal.profile.field.primaryRole")}>
            <input
              type="text"
              value={draft.primaryRole}
              onChange={(e) => patch("primaryRole", e.target.value)}
              style={inputStyle(theme)}
              placeholder=""
            />
          </Field>
          <Field theme={theme} label={t("portal.profile.field.homeCity")}>
            <input
              type="text"
              value={draft.city}
              onChange={(e) => patch("city", e.target.value)}
              style={inputStyle(theme)}
              placeholder={t("portal.profile.homeCityPh")}
            />
          </Field>
        </Grid2>
      </Section>

      <Section theme={theme} title={t("portal.profile.section.catering")}>
        <p style={{ margin: 0, marginBottom: 10, fontSize: 13, color: c.muted, lineHeight: 1.5 }}>
          {t("portal.profile.cateringHint")}
        </p>
        <Grid2>
          <Field theme={theme} label={t("portal.profile.field.dietary")}>
            <input
              type="text"
              value={draft.dietary}
              onChange={(e) => patch("dietary", e.target.value)}
              style={inputStyle(theme)}
              placeholder={t("portal.profile.dietPh")}
            />
          </Field>
          <Field theme={theme} label={t("portal.profile.field.allergies")}>
            <input
              type="text"
              value={draft.allergies}
              onChange={(e) => patch("allergies", e.target.value)}
              style={inputStyle(theme)}
              placeholder={t("portal.profile.allergiesPh")}
            />
          </Field>
        </Grid2>
      </Section>

      <Section theme={theme} title={t("portal.profile.section.travel")}>
        <p
          style={{
            margin: 0,
            marginBottom: 10,
            fontSize: 13,
            color: c.muted,
            lineHeight: 1.5,
          }}
        >
          {t("portal.profile.travelHint")}
        </p>
        <Grid2>
          <Field theme={theme} label={t("portal.profile.field.roomShare")}>
            <SegmentedControl
              theme={theme}
              value={draft.roomShare}
              onChange={(v) => patch("roomShare", v)}
              options={[
                { value: "twin", label: t("portal.profile.room.twin") },
                { value: "single", label: t("portal.profile.room.single") },
                { value: "either", label: t("portal.profile.room.either") },
              ]}
            />
          </Field>
          <Field theme={theme} label={t("portal.profile.field.gender")}>
            <SegmentedControl
              theme={theme}
              value={draft.gender}
              onChange={(v) => patch("gender", v)}
              options={[
                { value: "", label: t("portal.profile.gender.unset") },
                { value: "female", label: t("portal.profile.gender.female") },
                { value: "male", label: t("portal.profile.gender.male") },
                { value: "other", label: t("portal.profile.gender.other") },
              ]}
            />
          </Field>
        </Grid2>
      </Section>

      <Section theme={theme} title={t("portal.profile.section.skills")}>
        <p style={{ margin: 0, marginBottom: 10, fontSize: 13, color: c.muted, lineHeight: 1.5 }}>
          {t("portal.profile.skillsHint")}
        </p>
        <TagEditor
          theme={theme}
          tags={draft.skills}
          onChange={(tags) => patch("skills", tags)}
          placeholder={t("portal.profile.skillsPlaceholder")}
        />
      </Section>

      <Section theme={theme} title={t("portal.profile.section.languages")}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {LANGUAGE_PRESETS.map((l) => {
            const active = draft.languages.includes(l.value);
            return (
              <button
                key={l.value}
                type="button"
                onClick={() => {
                  patch(
                    "languages",
                    active
                      ? draft.languages.filter((x) => x !== l.value)
                      : [...draft.languages, l.value],
                  );
                }}
                style={{
                  padding: "7px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 999,
                  cursor: "pointer",
                  background: active ? c.accent : "transparent",
                  color: active ? "#0b0b0b" : c.text,
                  border: `1px solid ${active ? c.accent : c.border}`,
                }}
              >
                {t(l.key)}
              </button>
            );
          })}
        </div>
      </Section>

      <Section theme={theme} title={t("portal.profile.section.insurance")}>
        <Field theme={theme} label={t("portal.profile.field.insurance")}>
          <textarea
            value={draft.insurance}
            onChange={(e) => patch("insurance", e.target.value)}
            rows={2}
            style={{
              ...inputStyle(theme),
              resize: "vertical",
              fontFamily: "inherit",
            }}
            placeholder=""
          />
        </Field>
      </Section>

      <Section theme={theme} title={t("portal.profile.section.invoicing")}>
        <Grid2>
          <Field theme={theme} label={t("portal.profile.field.bank")}>
            <input
              type="text"
              value={draft.bankAccount}
              onChange={(e) => patch("bankAccount", e.target.value)}
              style={inputStyle(theme)}
              placeholder=""
            />
          </Field>
          <Field theme={theme} label={t("portal.profile.field.org")}>
            <input
              type="text"
              value={draft.orgNumber}
              onChange={(e) => patch("orgNumber", e.target.value)}
              style={inputStyle(theme)}
              placeholder=""
            />
          </Field>
        </Grid2>
      </Section>

      <div
        style={{
          position: "sticky",
          bottom: 80,
          display: "flex",
          justifyContent: "flex-end",
          paddingTop: 4,
          gap: 10,
        }}
      >
        {dirty ? (
          <button
            type="button"
            onClick={() => setDraft(data.profile)}
            style={{
              padding: "11px 16px",
              fontSize: 14,
              fontWeight: 700,
              background: "transparent",
              color: c.muted,
              border: `1px solid ${c.border}`,
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            {t("portal.profile.discard")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={!dirty}
          style={{
            padding: "11px 22px",
            fontSize: 14,
            fontWeight: 700,
            background: dirty ? c.accent : c.border,
            color: "#0b0b0b",
            border: "none",
            borderRadius: 10,
            cursor: dirty ? "pointer" : "not-allowed",
            opacity: dirty ? 1 : 0.7,
            boxShadow: dirty ? c.shadowSoft : "none",
          }}
        >
          {t("portal.profile.save")}
        </button>
      </div>
    </div>
  );
}

function ProfileAvatar({
  name,
  photoObjectPath,
  size,
}: {
  name: string;
  photoObjectPath: string;
  size: number;
}) {
  const baseUrl =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
    "/";
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  return photoObjectPath ? (
    <img
      src={`${baseUrl}api/portal/freelancers/me/photo`}
      alt={`${name || "User"} profile`}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        flex: "0 0 auto",
      }}
    />
  ) : (
    <div
      aria-label={`${name || "User"} initials`}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(248,128,0,0.18)",
        color: "#f88000",
        fontSize: 26,
        fontWeight: 800,
        flex: "0 0 auto",
      }}
    >
      {initials}
    </div>
  );
}

function TagEditor({
  theme,
  tags,
  onChange,
  placeholder,
}: {
  theme: ThemeMode;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const c = PALETTE[theme];
  const tr = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const suggestions = useMemo(
    () => searchSkills(query, tags),
    [query, tags],
  );

  function add(tag: string) {
    const t = tag.trim();
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setQuery("");
      return;
    }
    onChange([...tags, t]);
    setQuery("");
  }

  function remove(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {tags.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tags.map((t) => (
            <span
              key={t}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 6px 5px 12px",
                fontSize: 12,
                fontWeight: 700,
                background: "rgba(248,128,0,0.18)",
                color: c.accent,
                borderRadius: 999,
              }}
            >
              {t}
              <button
                type="button"
                onClick={() => remove(t)}
                aria-label={tr("portal.tag.remove").replace("{tag}", t)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: c.accent,
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: "0 4px",
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (suggestions.length > 0) {
                add(suggestions[0].label);
              } else if (query.trim()) {
                add(query);
              }
            } else if (e.key === "Backspace" && !query && tags.length > 0) {
              remove(tags[tags.length - 1]);
            }
          }}
          placeholder={placeholder}
          style={inputStyle(theme)}
        />
        {open && suggestions.length > 0 ? (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              background: c.cardBg,
              border: `1px solid ${c.border}`,
              borderRadius: 10,
              boxShadow: c.shadow,
              zIndex: 5,
              maxHeight: 240,
              overflowY: "auto",
            }}
          >
            {suggestions.map((s) => (
              <button
                key={s.label}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(s.label);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  gap: 10,
                  padding: "8px 12px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: c.text,
                  textAlign: "left",
                  fontSize: 13,
                  borderBottom: `1px solid ${c.border}`,
                  fontFamily: "inherit",
                }}
              >
                <span style={{ flex: 1, fontWeight: 600 }}>{s.label}</span>
                <span style={{ fontSize: 10, color: c.muted, fontWeight: 700, textTransform: "uppercase" }}>
                  {s.group}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Section({
  theme,
  title,
  children,
}: {
  theme: ThemeMode;
  title: string;
  children: React.ReactNode;
}) {
  const c = PALETTE[theme];
  return (
    <section
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: 14,
        padding: 16,
        boxShadow: c.shadowSoft,
      }}
    >
      <h2
        style={{
          margin: 0,
          marginBottom: 12,
          fontSize: 13,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: c.muted,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function SegmentedControl<T extends string>({
  theme,
  value,
  onChange,
  options,
}: {
  theme: ThemeMode;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  // Pill-group used for short, exclusive choices (room sharing,
  // gender). Mirrors the existing Languages preset pattern stylistically
  // so the profile editor stays visually consistent.
  const c = PALETTE[theme];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value || "_unset"}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              padding: "7px 14px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 999,
              cursor: "pointer",
              background: active ? c.accent : "transparent",
              color: active ? "#0b0b0b" : c.text,
              border: `1px solid ${active ? c.accent : c.border}`,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

function Field({
  theme,
  label,
  children,
}: {
  theme: ThemeMode;
  label: string;
  children: React.ReactNode;
}) {
  const c = PALETTE[theme];
  return (
    <label style={{ display: "block" }}>
      <span
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 700,
          color: c.muted,
          marginBottom: 5,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function inputStyle(theme: ThemeMode): React.CSSProperties {
  const c = PALETTE[theme];
  return {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    background: c.inputBg,
    color: c.text,
    border: `1px solid ${c.inputBorder}`,
    borderRadius: 8,
    boxSizing: "border-box",
    fontFamily: "inherit",
  };
}
