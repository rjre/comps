import http from "node:http";
import { google } from "googleapis";
import { GMAIL_SCOPES } from "@/lib/gmail/client";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

/**
 * One-time interactive setup: run this on a machine with a browser (your
 * laptop, or the Pi over `ssh -L 53682:localhost:53682 pi`), authorize
 * read-only Gmail access, and it prints a refresh token to put in .env as
 * GOOGLE_REFRESH_TOKEN. Never run unattended — it needs a human to click
 * "Allow" in Google's consent screen.
 */
async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first — see README for creating");
    console.error("an OAuth client in Google Cloud Console (type: Desktop app).");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh_token even on repeat authorizations
    scope: GMAIL_SCOPES,
  });

  console.log("\nOpen this URL in a browser and authorize with the Gmail account to scan:\n");
  console.log(authUrl);
  console.log(`\nWaiting for the redirect back to ${REDIRECT_URI} ...`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.end(error ? `Error: ${error}. Check the terminal.` : "Authorized — you can close this tab.");
      server.close();
      if (error) reject(new Error(error));
      else if (code) resolve(code);
      else reject(new Error("No code in callback"));
    });
    server.listen(PORT);
  });

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error("\nNo refresh_token returned — revoke this app's access at");
    console.error("https://myaccount.google.com/permissions and re-run this script.");
    process.exit(1);
  }

  console.log("\nAdd this to .env:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
