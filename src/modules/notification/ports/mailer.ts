/** Sends the outbound emails. */
export interface Mailer {
  sendConfirmation(email: string, repo: string, confirmToken: string, sagaId?: string): Promise<void>;
  sendReleaseNotification(
    email: string,
    repo: string,
    tag: string,
    unsubscribeToken: string,
  ): Promise<void>;
}
