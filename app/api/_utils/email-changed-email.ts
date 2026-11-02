import { Resend } from 'resend'
import { escapeHtml, resendFromAddress, resolveReminderDelivery, sanitizeHeaderText } from './email'

/**
 * Adminul a schimbat emailul de autentificare al unui cont. Anunțăm ambele
 * adrese: cea veche află că nu mai intră cu ea (și că trebuie să reacționeze
 * dacă nu se aștepta), cea nouă află că de acum intră cu ea. Erorile nu
 * schimbă rezultatul: emailul e deja schimbat.
 */
export async function sendEmailChangedNotices(input: { oldEmail: string; newEmail: string; fullName: string | null }) {
  const name = input.fullName?.trim()
  const greeting = name ? 'Bună, ' + name + ',' : 'Bună,'
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const loginUrl = appUrl ? appUrl + '/login' : null
  const messages = [
    {
      to: input.oldEmail,
      subject: 'Emailul contului tău Bonie a fost schimbat',
      lines: [
        'Un administrator a schimbat adresa de email a contului tău Bonie în ' + input.newEmail + '.',
        'De acum intri în cont cu noua adresă; parola rămâne aceeași.',
        'Dacă nu te așteptai la această schimbare, scrie-i administratorului platformei.',
      ],
    },
    {
      to: input.newEmail,
      subject: 'Intri în Bonie cu această adresă',
      lines: [
        'Un administrator a schimbat adresa de email a contului tău Bonie: de acum intri cu ' + input.newEmail + ' (înainte: ' + input.oldEmail + ').',
        'Parola rămâne aceeași. Dacă nu o mai știi, folosește „Ai uitat parola?” pe pagina de autentificare.',
        ...(loginUrl ? ['Intră în cont: ' + loginUrl] : []),
      ],
    },
  ]
  const resend = new Resend(process.env.RESEND_API_KEY)
  for (const message of messages) {
    try {
      const delivery = resolveReminderDelivery(message.to)
      if (!delivery.ok) continue
      const account = 'Acest mesaj privește contul ' + delivery.data.intendedEmail + '.'
      const { error } = await resend.emails.send({
        from: resendFromAddress(),
        to: delivery.data.deliveryEmail,
        subject: sanitizeHeaderText(message.subject),
        html: '<p>' + escapeHtml(greeting) + '</p>'
          + message.lines.map(line => '<p>' + escapeHtml(line) + '</p>').join('')
          + '<p style="color:#6b7280;font-size:12px">' + escapeHtml(account) + '</p>',
        text: [greeting, ...message.lines, account].join('\n\n'),
      })
      if (error) console.error('Email changed notice rejected:', error)
    } catch (error) {
      console.error('Email changed notice failed (non-blocking):', error)
    }
  }
}
