import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBriefEmailContent,
  briefEmailLogo,
  dispatchBriefRequestEmails,
  resolveProducerDisplayName,
  type BriefEmailDependencies,
  type BriefEmailProfile,
} from "./briefEmail";
import { buildRfc822 } from "./gmail";

it("embeds the official PNG in a related MIME part while retaining plain text", () => {
  const content = buildBriefEmailContent({
    recipientName: "Crew",
    producerName: "Producer",
    link: "https://example.com/brief",
  });
  const raw = buildRfc822({
    to: "crew@example.com",
    ...content,
    inlineImages: [briefEmailLogo],
  });
  assert.match(raw, /Content-Type: multipart\/alternative/);
  assert.match(raw, /Content-Type: multipart\/related/);
  assert.match(raw, /Content-ID: <ehs-logo@ehs>/);
  assert.match(raw, /Content-Disposition: inline; filename="ehs-logo.png"/);
  assert.match(raw, /Content-Type: image\/png/);
  const compact = raw.replace(/\r\n/g, "");
  assert.ok(compact.includes(Buffer.from(content.htmlBody).toString("base64")));
  assert.ok(compact.includes(Buffer.from(content.textBody).toString("base64")));
  assert.ok(compact.includes(briefEmailLogo.content.toString("base64")));
  assert.equal(briefEmailLogo.content.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

it("keeps unrelated HTML emails attachment-free", () => {
  const raw = buildRfc822({
    to: "crew@example.com", subject: "Test", textBody: "Hello", htmlBody: "<p>Hello</p>",
  });
  assert.match(raw, /multipart\/alternative/);
  assert.doesNotMatch(raw, /multipart\/related|Content-ID:/);
});

function dependencies(
  profiles: BriefEmailProfile[],
  deliveries: Array<{
    to: string;
    subject: string;
    textBody: string;
    htmlBody?: string;
  }> = [],
): BriefEmailDependencies {
  return {
    lookupProducerName: async () => "Test Producer",
    loadProfiles: async () => profiles,
    loadBriefSummary: async () => ({
      projectName: "Nobelkonserten",
      venue: "Oslo Spektrum",
      startDate: "2026-12-10",
      endDate: "2026-12-12",
      rolesByUserId: { "freelancer-secret-id": ["Lydtekniker"] },
    }),
    send: async (message) => {
      assert.deepEqual(message.inlineImages, [briefEmailLogo]);
      deliveries.push({
        to: message.to,
        subject: message.subject,
        textBody: message.textBody,
        htmlBody: message.htmlBody,
      });
      return { ok: true, id: `message-${deliveries.length}` };
    },
  };
}

const baseArgs = {
  briefId: "project-brief-123",
  ownerUserId: "producer-1",
};

describe("brief email dispatch", () => {
  it("consolidates multiple role assignments into one email per freelancer", async () => {
    const deliveries: Array<{ to: string; subject: string; textBody: string; htmlBody?: string }> = [];
    const result = await dispatchBriefRequestEmails(
      {
        ...baseArgs,
        newRecipientUserIds: ["freelancer-1", "freelancer-1"],
      },
      dependencies(
        [{ userId: "freelancer-1", email: "crew@example.com", fullName: "Crew Member" }],
        deliveries,
      ),
    );

    assert.equal(deliveries.length, 1);
    assert.deepEqual(result, {
      sent: 1,
      skipped: 0,
      outcomes: [{ freelancerUserId: "freelancer-1", sent: true }],
    });
  });

  it("skips missing and blank-email profiles with exact reporting", async () => {
    const deliveries: Array<{ to: string; subject: string; textBody: string; htmlBody?: string }> = [];
    const result = await dispatchBriefRequestEmails(
      {
        ...baseArgs,
        newRecipientUserIds: [
          "valid",
          "blank-email",
          "invalid-email",
          "missing-profile",
        ],
      },
      dependencies(
        [
          { userId: "valid", email: "valid@example.com", fullName: "Valid Crew" },
          { userId: "blank-email", email: "   ", fullName: "No Email" },
          { userId: "invalid-email", email: "not-an-email", fullName: "Bad Email" },
        ],
        deliveries,
      ),
    );

    assert.equal(deliveries.length, 1);
    assert.equal(result.sent, 1);
    assert.equal(result.skipped, 3);
    assert.deepEqual(
      result.outcomes.sort((a, b) =>
        a.freelancerUserId.localeCompare(b.freelancerUserId),
      ),
      [
        { freelancerUserId: "blank-email", sent: false },
        { freelancerUserId: "invalid-email", sent: false },
        { freelancerUserId: "missing-profile", sent: false },
        { freelancerUserId: "valid", sent: true },
      ],
    );
  });

  it("sends a Norwegian summary card and authenticated project brief link", async () => {
    const deliveries: Array<{ to: string; subject: string; textBody: string; htmlBody?: string }> = [];
    await dispatchBriefRequestEmails(
      { ...baseArgs, newRecipientUserIds: ["freelancer-secret-id"] },
      dependencies(
        [{ userId: "freelancer-secret-id", email: "crew@example.com", fullName: "Crew" }],
        deliveries,
      ),
    );

    const body = deliveries[0]?.textBody ?? "";
    const link = body
      .split("\n")
      .find((line) => line.startsWith("https://app.ehs.no/"));
    assert.ok(link);
    const url = new URL(link);
    assert.equal(url.searchParams.get("view"), "portal");
    assert.equal(url.searchParams.get("brief"), "project-brief-123");
    assert.equal(url.searchParams.has("freelancer"), false);
    assert.equal(url.toString().includes("freelancer-secret-id"), false);
    assert.equal(deliveries[0]?.subject, "Ny forespørsel: Nobelkonserten");
    assert.match(body, /^Hei Crew,/);
    assert.match(body, /Du har fått en ny forespørsel fra Test Producer\./);
    assert.match(body, /Prosjekt: Nobelkonserten/);
    assert.match(body, /Dato: 10\. desember 2026 – 12\. desember 2026/);
    assert.match(body, /Rolle: Lydtekniker/);
    assert.match(body, /Sted: Oslo Spektrum/);
    assert.match(
      body,
      /Hvis knappen over ikke fungerer, lim inn denne lenken i nettleseren:/,
    );
    const html = deliveries[0]?.htmlBody ?? "";
    assert.match(html, /Crew Management System/);
    assert.match(html, />Åpne brief i portal</);
    assert.match(html, /Nobelkonserten/);
    assert.match(html, /Lydtekniker/);
    assert.match(html, /Oslo Spektrum/);
    assert.equal(html.includes("freelancer-secret-id"), false);
  });

  it("falls back cleanly when summary fields are missing", () => {
    const content = buildBriefEmailContent({
      recipientName: "",
      producerName: "Prosjektleder",
      link: "https://app.ehs.no/?view=portal&brief=brief-1",
      projectName: null,
      venue: null,
      startDate: null,
      endDate: null,
      role: null,
    });

    assert.equal(content.subject, "Ny forespørsel om oppdrag");
    assert.match(content.textBody, /Hei der,/);
    assert.match(content.textBody, /Prosjekt: Ikke oppgitt/);
    assert.match(content.textBody, /Dato: Ikke oppgitt/);
    assert.match(content.textBody, /Rolle: Ikke oppgitt/);
    assert.match(content.textBody, /Sted: Ikke oppgitt/);
    assert.match(content.htmlBody, /Prosjekt/);
    assert.match(content.htmlBody, /src="cid:ehs-logo@ehs"/);
    assert.match(content.htmlBody, /width="156" height="40"/);
    assert.match(content.htmlBody, /alt="EHS - LYD · LYS · BILDE"/);
    assert.doesNotMatch(content.htmlBody, />EHS</);
    assert.match(
      content.htmlBody,
      /word-break:break-all;font-family:monospace;font-size:12px;line-height:18px;color:#666666/,
    );
  });

  it("changes only the requested copy for Share Brief notifications", () => {
    const shared = buildBriefEmailContent({
      recipientName: "Kari",
      producerName: "Ola Nordmann",
      link: "https://app.ehs.no/?view=portal&brief=brief-1",
      projectName: "Nobelkonserten",
      venue: "Oslo Spektrum",
      startDate: "2026-12-10",
      endDate: "2026-12-12",
      role: "Lydtekniker",
      notificationType: "share_brief",
    });

    assert.equal(shared.subject, "Prosjektbrief: Nobelkonserten");
    assert.match(
      shared.textBody,
      /Ola Nordmann har delt en prosjektbrief med deg\./,
    );
    assert.match(shared.textBody, /Se prosjektbrief:/);
    assert.match(shared.htmlBody, />Se prosjektbrief</);
    assert.doesNotMatch(shared.htmlBody, />Åpne brief i portal</);
    assert.match(shared.htmlBody, /Prosjekt/);
    assert.match(shared.htmlBody, /Dato/);
    assert.match(shared.htmlBody, /Rolle/);
    assert.match(shared.htmlBody, /Sted/);
  });

  it("uses a clean subject fallback for a shared brief without a project name", () => {
    const shared = buildBriefEmailContent({
      recipientName: "Kari",
      producerName: "EHS",
      link: "https://app.ehs.no/?view=portal&brief=brief-1",
      projectName: " Ikke oppgitt ",
      notificationType: "share_brief",
    });

    assert.equal(shared.subject, "Ny prosjektbrief");
  });

  it("resolves producer display names without exposing full email addresses", () => {
    assert.equal(
      resolveProducerDisplayName({
        fullName: "Ola Nordmann",
        organizationName: "EHS Norge",
        email: "olti@ehs.no",
      }),
      "Ola Nordmann",
    );
    assert.equal(
      resolveProducerDisplayName({
        organizationName: "EHS Norge",
        email: "olti@ehs.no",
      }),
      "EHS Norge",
    );
    assert.equal(
      resolveProducerDisplayName({ email: "olti@ehs.no" }),
      "olti",
    );
    assert.equal(resolveProducerDisplayName({}), "EHS");
  });
});