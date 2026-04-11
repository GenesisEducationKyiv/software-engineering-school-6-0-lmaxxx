import nodemailer from 'nodemailer';
import { config } from '../config.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  auth: config.smtp.user
    ? { user: config.smtp.user, pass: config.smtp.pass }
    : undefined,
});

export async function sendConfirmationEmail(
  email: string,
  repo: string,
  confirmToken: string,
): Promise<void> {
  const confirmUrl = `${config.baseUrl}/api/confirm/${confirmToken}`;
  await transporter.sendMail({
    from: config.smtp.user || 'noreply@github-notifier.local',
    to: email,
    subject: `Confirm your subscription to ${repo} releases`,
    text: [
      `Please confirm your subscription to receive release notifications for ${repo}:`,
      '',
      confirmUrl,
    ].join('\n'),
  });
}

export async function sendReleaseNotification(
  email: string,
  repo: string,
  tag: string,
  unsubscribeToken: string,
): Promise<void> {
  const releaseUrl = `https://github.com/${repo}/releases/tag/${tag}`;
  const unsubscribeUrl = `${config.baseUrl}/api/unsubscribe/${unsubscribeToken}`;
  await transporter.sendMail({
    from: config.smtp.user || 'noreply@github-notifier.local',
    to: email,
    subject: `New release of ${repo}: ${tag}`,
    text: [
      `A new release has been published for ${repo}!`,
      `Version: ${tag}`,
      `View release: ${releaseUrl}`,
      '',
      `To unsubscribe: ${unsubscribeUrl}`,
    ].join('\n'),
  });
}
