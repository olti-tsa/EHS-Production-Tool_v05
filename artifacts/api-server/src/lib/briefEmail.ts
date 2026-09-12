import { eq, inArray } from "drizzle-orm";
import { createClerkClient } from "@clerk/express";
import {
  briefAssignmentsTable,
  db,
  freelancerProfilesTable,
  projectBriefsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { sendGmail } from "./gmail";
import { buildPortalBriefUrl } from "./portalUrl";
import { readFileSync } from "node:fs";

export const briefEmailLogo = {
  contentId: "ehs-logo@ehs",
  filename: "ehs-logo.png",
  content: readFileSync(new URL("./assets/ehs-logo.png", import.meta.url)),
};

const clerk = process.env.CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  : null;

export function resolveProducerDisplayName(args: {
  fullName?: string | null;
  organizationName?: string | null;
  email?: string | null;
}): string {
  const fullName = args.fullName?.trim();
  if (fullName) return fullName;
  const organizationName = args.organizationName?.trim();
  if (organizationName) return organizationName;
  const emailUsername = args.email?.split("@", 1)[0]?.trim();
  return emailUsername || "EHS";
}

async function lookupProducerName(userId: string): Promise<string> {
  if (!clerk) return "EHS";
  try {
    const user = await clerk.users.getUser(userId);
    const fullName = [user.firstName ?? "", user.lastName ?? ""]
      .join(" ")
      .trim();
    const primary = user.emailAddresses?.find(
      (e) => e.id === user.primaryEmailAddressId,
    )?.emailAddress;
    let organizationName: string | null = null;
    if (!fullName) {
      try {
        const memberships = await clerk.users.getOrganizationMembershipList({
          userId,
          limit: 1,
        });
        organizationName = memberships.data[0]?.organization.name ?? null;
      } catch (err) {
        logger.warn(
          { userId, err: err instanceof Error ? err.message : String(err) },
          "could not resolve producer organization from Clerk",
        );
      }
    }
    return resolveProducerDisplayName({
      fullName,
      organizationName,
      email: primary,
    });
  } catch (err) {
    logger.warn(
      { userId, err: err instanceof Error ? err.message : String(err) },
      "could not resolve producer name from Clerk",
    );
    return "EHS";
  }
}

export type BriefEmailProfile = {
  userId: string;
  email: string | null;
  fullName: string | null;
};

export type BriefEmailDependencies = {
  lookupProducerName: (userId: string) => Promise<string>;
  loadProfiles: (userIds: string[]) => Promise<BriefEmailProfile[]>;
  loadBriefSummary: (briefId: string) => Promise<BriefEmailSummary | null>;
  send: typeof sendGmail;
};

export type BriefEmailSummary = {
  projectName: string | null;
  venue: string | null;
  startDate: string | null;
  endDate: string | null;
  rolesByUserId: Record<string, string[]>;
};

export type BriefNotificationType = "send_request" | "share_brief";

const defaultDependencies: BriefEmailDependencies = {
  lookupProducerName,
  loadProfiles: async (userIds) =>
    db
      .select({
        userId: freelancerProfilesTable.userId,
        email: freelancerProfilesTable.email,
        fullName: freelancerProfilesTable.fullName,
      })
      .from(freelancerProfilesTable)
      .where(inArray(freelancerProfilesTable.userId, userIds)),
  loadBriefSummary: async (briefId) => {
    const [briefRows, assignments] = await Promise.all([
      db
        .select({
          projectName: projectBriefsTable.projectName,
          venue: projectBriefsTable.venue,
          startDate: projectBriefsTable.startDate,
          endDate: projectBriefsTable.endDate,
          data: projectBriefsTable.data,
        })
        .from(projectBriefsTable)
        .where(eq(projectBriefsTable.id, briefId))
        .limit(1),
      db
        .select({
          freelancerUserId: briefAssignmentsTable.freelancerUserId,
          crewId: briefAssignmentsTable.crewId,
        })
        .from(briefAssignmentsTable)
        .where(eq(briefAssignmentsTable.briefId, briefId)),
    ]);
    const brief = briefRows[0];
    if (!brief) return null;
    const data =
      brief.data && typeof brief.data === "object"
        ? (brief.data as Record<string, unknown>)
        : {};
    const crewRows = Array.isArray(data.assignments)
      ? (data.assignments as Record<string, unknown>[])
      : [];
    const roleByCrewId = new Map(
      crewRows.flatMap((row) =>
        typeof row.crewId === "string" && typeof row.role === "string"
          ? [[row.crewId, row.role.trim()] as const]
          : [],
      ),
    );
    const rolesByUserId: Record<string, string[]> = {};
    for (const assignment of assignments) {
      const role = roleByCrewId.get(assignment.crewId);
      if (!role) continue;
      const roles = rolesByUserId[assignment.freelancerUserId] ?? [];
      if (!roles.includes(role)) roles.push(role);
      rolesByUserId[assignment.freelancerUserId] = roles;
    }
    return {
      projectName: brief.projectName || null,
      venue: brief.venue || null,
      startDate: brief.startDate,
      endDate: brief.endDate,
      rolesByUserId,
    };
  },
  send: sendGmail,
};

export function isValidBriefRecipientEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function displayValue(value: string | null | undefined): string {
  return value?.trim() || "Ikke oppgitt";
}

function formatNorwegianDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDateRange(
  startDate: string | null,
  endDate: string | null,
): string {
  const start = formatNorwegianDate(startDate);
  const end = formatNorwegianDate(endDate);
  if (!start && !end) return "Ikke oppgitt";
  if (!start) return end!;
  if (!end || endDate === startDate) return start;
  return `${start} – ${end}`;
}

export function buildBriefEmailContent(args: {
  recipientName: string;
  producerName: string;
  link: string;
  projectName?: string | null;
  venue?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  role?: string | null;
  notificationType?: BriefNotificationType;
}): { subject: string; textBody: string; htmlBody: string } {
  const recipientName = args.recipientName.trim() || "der";
  const producerName = displayValue(args.producerName);
  const projectName = displayValue(args.projectName);
  const venue = displayValue(args.venue);
  const role = displayValue(args.role);
  const dates = formatDateRange(args.startDate ?? null, args.endDate ?? null);
  const isSharedBrief = args.notificationType === "share_brief";
  const hasProjectName =
    Boolean(args.projectName?.trim()) &&
    args.projectName?.trim().toLocaleLowerCase("nb-NO") !== "ikke oppgitt";
  const subject = hasProjectName
    ? isSharedBrief
      ? `Prosjektbrief: ${projectName}`
      : `Ny forespørsel: ${projectName}`
    : isSharedBrief
      ? "Ny prosjektbrief"
      : "Ny forespørsel om oppdrag";
  const intro = isSharedBrief
    ? `${producerName} har delt en prosjektbrief med deg.`
    : `Du har fått en ny forespørsel fra ${producerName}.`;
  const cta = isSharedBrief ? "Se prosjektbrief" : "Åpne brief i portal";
  const fallback =
    "Hvis knappen over ikke fungerer, lim inn denne lenken i nettleseren:";
  const textBody = [
    `Hei ${recipientName},`,
    "",
    intro,
    "",
    `Prosjekt: ${projectName}`,
    `Dato: ${dates}`,
    `Rolle: ${role}`,
    `Sted: ${venue}`,
    "",
    `${cta}:`,
    args.link,
    "",
    fallback,
    args.link,
  ].join("\n");
  const summaryRows = [
    ["Prosjekt", projectName],
    ["Dato", dates],
    ["Rolle", role],
    ["Sted", venue],
  ]
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:7px 12px 7px 0;font-family:Arial,sans-serif;font-size:14px;line-height:20px;font-weight:700;color:#334155;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}:</td>
          <td style="padding:7px 0;font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#0f172a;vertical-align:top;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");
  const htmlBody = `<!doctype html>
<html lang="no">
<head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f1f5f9;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:22px 28px;background:#111827;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td width="156" valign="middle" style="width:156px;vertical-align:middle;">
                  <img src="cid:${briefEmailLogo.contentId}" width="156" height="40" border="0" alt="EHS - LYD · LYS · BILDE" style="display:block;width:156px;height:40px;border:0;outline:none;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#ffffff;">
                </td>
                <td align="right" valign="middle" style="padding-left:16px;vertical-align:middle;font-family:Arial,sans-serif;font-size:13px;line-height:18px;font-weight:700;color:#ffffff;">Crew Management System</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td style="padding:30px 28px 14px;font-family:Arial,sans-serif;color:#0f172a;">
          <p style="margin:0 0 14px;font-size:18px;line-height:26px;font-weight:700;">Hei ${escapeHtml(recipientName)},</p>
          <p style="margin:0;font-size:15px;line-height:24px;color:#334155;">${escapeHtml(intro)}</p>
        </td></tr>
        <tr><td style="padding:10px 28px 22px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
            <tr><td style="padding:14px 18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${summaryRows}</table></td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:2px 28px 26px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#111827" style="border-radius:8px;">
            <a href="${escapeHtml(args.link)}" style="display:inline-block;padding:14px 24px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${cta}</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:0 28px 30px;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">
          <p style="margin:0 0 6px;">${fallback}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
            <tr><td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;word-break:break-all;font-family:monospace;font-size:12px;line-height:18px;color:#666666;">
              <a href="${escapeHtml(args.link)}" style="word-break:break-all;font-family:monospace;font-size:12px;line-height:18px;color:#666666;text-decoration:underline;">${escapeHtml(args.link)}</a>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, textBody, htmlBody };
}

export async function dispatchBriefRequestEmails(args: {
  briefId: string;
  ownerUserId: string;
  newRecipientUserIds: string[];
  notificationType?: BriefNotificationType;
}, dependencies: BriefEmailDependencies = defaultDependencies): Promise<{ sent: number; skipped: number; outcomes: { freelancerUserId: string; sent: boolean }[] }> {
  const recipientUserIds = [...new Set(args.newRecipientUserIds)];
  if (recipientUserIds.length === 0) return { sent: 0, skipped: 0, outcomes: [] };
  try {
    const link = buildPortalBriefUrl(args.briefId);
    const [producerName, summary] = await Promise.all([
      dependencies.lookupProducerName(args.ownerUserId),
      dependencies.loadBriefSummary(args.briefId),
    ]);

    const profiles = await dependencies.loadProfiles(recipientUserIds);

    const profileIds = new Set(profiles.map((p) => p.userId));
    let sent = 0;
    let skipped = recipientUserIds.length - profileIds.size;
    const outcomes: { freelancerUserId: string; sent: boolean }[] = [];
    for (const uid of recipientUserIds) {
      if (!profileIds.has(uid)) {
        outcomes.push({ freelancerUserId: uid, sent: false });
        logger.info(
          { briefId: args.briefId, freelancerUserId: uid },
          "brief email skipped: no freelancer profile",
        );
      }
    }

    for (const p of profiles) {
      const to = (p.email ?? "").trim();
      if (!isValidBriefRecipientEmail(to)) {
        skipped += 1;
        outcomes.push({ freelancerUserId: p.userId, sent: false });
        logger.info(
          { briefId: args.briefId, freelancerUserId: p.userId },
          "brief email skipped: missing or invalid freelancer email",
        );
        continue;
      }
      const recipientName = (p.fullName ?? "").trim();
      const content = buildBriefEmailContent({
        recipientName,
        producerName,
        link,
        projectName: summary?.projectName,
        venue: summary?.venue,
        startDate: summary?.startDate,
        endDate: summary?.endDate,
        role: summary?.rolesByUserId[p.userId]?.join(" / "),
        notificationType: args.notificationType,
      });
      const result = await dependencies.send({
        to,
        toName: recipientName || undefined,
        subject: content.subject,
        textBody: content.textBody,
        htmlBody: content.htmlBody,
        inlineImages: [briefEmailLogo],
      });
      if (result.ok) {
        sent += 1;
        outcomes.push({ freelancerUserId: p.userId, sent: true });
        logger.info(
          {
            briefId: args.briefId,
            freelancerUserId: p.userId,
            messageId: result.id,
          },
          "brief request email sent",
        );
      } else {
        skipped += 1;
        outcomes.push({ freelancerUserId: p.userId, sent: false });
        // Intentionally do NOT log the recipient address — userId is
        // enough to correlate with the freelancer profile, and avoids
        // dropping PII into the log stream.
        logger.warn(
          {
            briefId: args.briefId,
            freelancerUserId: p.userId,
            error: result.error,
          },
          "brief request email failed",
        );
      }
    }
    return { sent, skipped, outcomes };
  } catch (err) {
    logger.error(
      {
        briefId: args.briefId,
        err: err instanceof Error ? err.message : String(err),
      },
      "dispatchBriefRequestEmails failed",
    );
    return { sent: 0, skipped: recipientUserIds.length, outcomes: recipientUserIds.map((freelancerUserId) => ({ freelancerUserId, sent: false })) };
  }
}
