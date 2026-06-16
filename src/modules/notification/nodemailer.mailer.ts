import { sendConfirmationEmail, sendReleaseNotification } from '../../infra/mailer.js';
import type { Mailer } from './ports/mailer.js';

export function createNodemailerMailer(): Mailer {
  return {
    sendConfirmation(email, repo, confirmToken) {
      return sendConfirmationEmail(email, repo, confirmToken);
    },
    sendReleaseNotification(email, repo, tag, unsubscribeToken) {
      return sendReleaseNotification(email, repo, tag, unsubscribeToken);
    },
  };
}
