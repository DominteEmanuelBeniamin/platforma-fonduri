import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPasswordResetAdminUrl,
  escapePasswordResetIlikePattern,
  isPasswordResetTargetRole,
  normalizePasswordResetEmail,
  passwordResetAdminDeliveryRecipients,
  renderPasswordChangedSecurityEmail,
  renderPasswordResetAdminEmail,
} from './password-reset.ts'

test('normalizează și validează emailul cererii fără a schimba parola', () => {
  assert.equal(normalizePasswordResetEmail('  User@Example.COM '), 'user@example.com')
  assert.equal(normalizePasswordResetEmail('not-an-email'), null)
  assert.equal(normalizePasswordResetEmail(null), null)
  assert.equal(normalizePasswordResetEmail(`${'a'.repeat(250)}@example.com`), null)
})

test('acceptă doar rolurile client și consultant', () => {
  assert.equal(isPasswordResetTargetRole('client'), true)
  assert.equal(isPasswordResetTargetRole('consultant'), true)
  assert.equal(isPasswordResetTargetRole('admin'), false)
  assert.equal(isPasswordResetTargetRole(undefined), false)
})

test('în development trimite emailul admin doar la override, iar în producție la adminii reali', () => {
  const admins = ['admin1@example.com', 'admin2@example.com']
  assert.deepEqual(
    passwordResetAdminDeliveryRecipients(admins, {
      production: false,
      developmentOverride: ' Sandu20321@Gmail.com ',
    }),
    ['sandu20321@gmail.com'],
  )
  assert.deepEqual(
    passwordResetAdminDeliveryRecipients(admins, { production: false }),
    [],
  )
  assert.deepEqual(
    passwordResetAdminDeliveryRecipients(admins, {
      production: true,
      developmentOverride: 'dev@example.com',
    }),
    admins,
  )
})

test('escapează wildcard-urile din lookup-ul ilike', () => {
  assert.equal(escapePasswordResetIlikePattern('User%_\\@Example.COM'), 'User\\%\\_\\\\@Example.COM')
})

test('construiește linkul admin numai din URL-ul aplicației', () => {
  assert.equal(
    buildPasswordResetAdminUrl('https://platforma.example/', 'user/123'),
    'https://platforma.example/admin/users/user%2F123',
  )
  assert.throws(() => buildPasswordResetAdminUrl('javascript:alert(1)', 'user-id'))
})

test('randează emailul admin cu HTML escaped și fără parolă', () => {
  const email = renderPasswordResetAdminEmail({
    targetName: '<Ana>\nPopescu',
    targetEmail: 'ana@example.com',
    targetRole: 'client',
    requestedAt: '2026-09-08T10:00:00.000Z',
    adminUrl: 'https://platforma.example/admin/users/abc',
  })

  assert.equal(email.subject.includes('\n'), false)
  assert.match(email.html, /&lt;Ana&gt; Popescu/)
  assert.match(email.html, /<strong>Rol<\/strong><\/dt><dd>Client<\/dd>/)
  assert.match(email.html, /https:\/\/platforma\.example\/admin\/users\/abc/)
  assert.doesNotMatch(email.text + email.html, /parolă\s*:/i)
})

test('emailul de securitate nu include parola', () => {
  const email = renderPasswordChangedSecurityEmail({ targetName: '<Ana>' })

  assert.match(email.text, /parola contului tău a fost schimbată/i)
  assert.match(email.html, /&lt;Ana&gt;/)
  assert.doesNotMatch(email.text + email.html, /parolă\s*:/i)
})
