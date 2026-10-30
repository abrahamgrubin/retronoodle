/** RN-062: the one outbound-message interface (RN-058's Slack notifier is meant to sit behind the
 * same shape). Plain text only — retro names and people's names are user input, never HTML. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Notifier {
  sendEmail(message: EmailMessage): Promise<void>;
}

const RESEND_URL = 'https://api.resend.com/emails';

/** Sends through Resend's HTTP API. Throws on any non-2xx so pg-boss retries the job; the error
 * carries only the status code — never the recipient, body or API key. */
export class ResendNotifier implements Notifier {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendEmail(message: EmailMessage): Promise<void> {
    const res = await this.fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
  }
}
