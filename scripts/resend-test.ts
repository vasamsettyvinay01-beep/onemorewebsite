/**
 * Sends a test email through Resend to check the API key works.
 *
 *   $env:RESEND_API_KEY="re_xxxxxxxxx"
 *   node scripts/resend-test.ts [to-address]
 */
import { Resend } from "resend";

const key = process.env.RESEND_API_KEY;
if (!key) {
  console.error("Set RESEND_API_KEY.");
  process.exit(1);
}

const resend = new Resend(key);

const { data, error } = await resend.emails.send({
  from: "onboarding@resend.dev",
  to: process.argv[2] ?? "vasamsettyvinay.01@gmail.com",
  subject: "Hello World",
  html: "<p>Congrats on sending your <strong>first email</strong>!</p>",
});

if (error) {
  console.error(error);
  process.exit(1);
}
console.log(`Sent: ${data?.id}`);
