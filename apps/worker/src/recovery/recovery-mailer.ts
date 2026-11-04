import { createTransport, type Transporter } from 'nodemailer'

export interface RecoveryMessage {
  to: string
  resetUrl: string
  expiresAt: Date
}

export class RecoveryMailer {
  private readonly transporter: Transporter | undefined

  constructor(
    private readonly options: {
      enabled: boolean
      smtpUrl?: string
      from: string
      connectionTimeoutMs: number
      greetingTimeoutMs: number
      socketTimeoutMs: number
      ignoreTls: boolean
    },
  ) {
    if (options.enabled) {
      if (!options.smtpUrl) {
        throw new Error('RECOVERY_SMTP_URL is required when email is enabled.')
      }
      this.transporter = createTransport({
        url: options.smtpUrl,
        connectionTimeout: options.connectionTimeoutMs,
        greetingTimeout: options.greetingTimeoutMs,
        socketTimeout: options.socketTimeoutMs,
        ignoreTLS: options.ignoreTls,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    }
  }

  async send(message: RecoveryMessage): Promise<void> {
    if (!this.transporter) {
      throw new Error('Recovery email delivery is disabled.')
    }
    await this.transporter.sendMail({
      from: this.options.from,
      to: message.to,
      subject: 'Reset your ctrorec password',
      text: [
        'A password reset was requested for your ctrorec account.',
        '',
        'Open this one-time link to choose a new password:',
        message.resetUrl,
        '',
        `This link expires at ${message.expiresAt.toISOString()}.`,
        'It can be used once. Request a new link if this one expires.',
        '',
        'If you did not request this, you can ignore this email. Your password has not changed.',
        '',
        'ctrorec — lecture audio, kept within your institution.',
      ].join('\n'),
    })
  }

  async close(): Promise<void> {
    this.transporter?.close()
  }
}
