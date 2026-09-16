import nodemailer from "nodemailer";

type EmailContent = { subject: string; text: string; html: string };

/** SMTP configuration stays server-side and is shared by sign-in codes and invitations. */
export async function sendEmail(to: string, content: EmailContent) {
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST is required.");
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 1025),
    secure: process.env.SMTP_SECURE === "true",
    ...(process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
      : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      transporter.sendMail({
        from: process.env.SMTP_FROM || "Repère <hello@repere.local>",
        to,
        ...content,
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          transporter.close();
          reject(new Error("Email delivery timed out."));
        }, 30000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    transporter.close();
  }
}
