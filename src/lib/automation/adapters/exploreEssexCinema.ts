import { isMailConfigured, openMailbox } from "@/lib/gmail/mailbox";
import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Explore Essex (Essex County Council) — "Win Vue Cinema Tickets with
 * Essex Explorer and Essex Film Office" prize draw. Unlike every other
 * adapter in this project, there is no web form at all — confirmed
 * directly from the page's own "How to enter" copy
 * (explore-essex.com/ee-comp): entry is by emailing the trivia answer to
 * Explore.Essex@essex.gov.uk with the exact subject line "Cinema
 * Competition". This adapter therefore ignores `page` entirely and sends
 * through the same mailbox the win-notification/mail-triage system
 * already uses (GMAIL_ADDRESS + GMAIL_APP_PASSWORD, or OAuth — see
 * src/lib/gmail/mailbox.ts) rather than driving a browser.
 *
 * Trivia question/answer, confirmed from the page's own copy ("Q: What is
 * the surname of the sisters in 'Practical Magic 2'? A: a) Walsh b) Owens
 * c) Dixon") and hand-researched rather than guessed between the three:
 * the Owens family (Sally and Gillian Owens) is the established surname
 * from the original Practical Magic (1998) and Alice Hoffman's novels
 * that "Practical Magic 2" continues — Walsh and Dixon are decoys.
 *
 * No purchase necessary, UK residents 18+, one entry per person per the
 * page's own T&Cs (though T&C #12 says multiple entries are technically
 * accepted — only ever sending one here regardless, same one-entry rule
 * this project applies everywhere). Closes 23:59 Sunday 25 Oct 2026 —
 * already GMT by then (BST ends that same morning), so 23:59 UTC.
 */
export const exploreEssexCinemaAdapter: CompetitionAdapter = {
  key: "explore-essex-cinema",
  siteName: "Explore Essex",
  async enterCompetition({ profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    if (!isMailConfigured()) {
      await log.warn(
        "Mail is not configured (GMAIL_ADDRESS/GMAIL_APP_PASSWORD or OAuth) — required to enter this email-only competition",
      );
      return { status: "FAILED", message: "Mail not configured — required to enter this email-only competition" };
    }

    const to = "Explore.Essex@essex.gov.uk";
    const subject = "Cinema Competition";
    const body = [
      "Hi,",
      "",
      "I'd like to enter the Vue Cinema tickets prize draw with Essex Explorer and Essex Film Office.",
      "",
      "Q: What is the surname of the sisters in 'Practical Magic 2'?",
      "A: Owens",
      "",
      `Name: ${profile.firstName} ${profile.lastName}`,
      `Email: ${profile.email}`,
    ].join("\n");

    if (dryRun) {
      await log.info(`Dry run — would have emailed ${to} with subject "${subject}" and answer "Owens"`);
      return { status: "SUCCESS", message: "Dry run: would have sent entry email" };
    }

    const mailbox = await openMailbox();
    try {
      await log.info(`Sending entry email to ${to}`);
      const sent = await mailbox.send(to, subject, body);
      if (!sent) {
        await log.warn("Mailbox reported the entry email failed to send");
        return { status: "FAILED", message: "Entry email failed to send" };
      }
      await log.info("Entry email sent");
      return { status: "SUCCESS", message: `Emailed ${to} with subject "${subject}"` };
    } finally {
      await mailbox.close();
    }
  },
};
