import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { makeConfig, restore, scrubPii, scrubSecrets } from '../hooks/redact'

// Adapté de test/detect.test.mts (dépôt d'origine) au format `claude plugin test`.
// Les fausses clés sont assemblées en morceaux, pour que les scanners de secrets
// (GitHub push protection, gitleaks) ne les prennent pas pour de vraies clés.
const j = (...parts: string[]) => parts.join('')
const ANT = j('sk-', 'ant-api03-', 'Zx8Q2mLpR7vT4nK9wYbF1cJhE6sAdG0uH3iO5rP')

const cfg = makeConfig({})
const scrub = (text: string): string => scrubPii(scrubSecrets(text, cfg), cfg)

const HIDE: readonly string[] = [
  `ANTHROPIC_API_KEY=${ANT}`,
  j('export GITHUB_TOKEN=', 'ghp', '_1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuVwXyZ'),
  j('aws_access_key_id = ', 'AKIA', 'IOSFODNN7EXAMPLE'),
  j('STRIPE_SECRET=', 'sk_', 'live_', '51H8xQ2LpR7vT4nK9wYbF1cJhE6s'),
  'db: postgres://acs:S3cur3-p4ss-w0rd-here@db.example.com:5432/main',
  j('Authorization: Bearer ', 'eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
  'R2_SECRET_ACCESS_KEY="C3J27XDCG2LmlZGEONYlgCtjfIZ4SOcM"',
  'a bare high-entropy token z9CPVNPkNa1Hedcm4pMbXDuCL1mHoOsF here',
  j('AIza', 'SyCjoSAqe6M7N3dSdh-uygUgSuBjkYnYhiw'),
  'contact me at dana.whitfield@northwind-labs.io',
  'origin 91.198.174.192 hit the worker',
  'v6 2001:0db8:85a3:0000:0000:8a2e:0370:7334 seen',
  j('-----BEGIN RSA ', 'PRIVATE KEY-----\nMIIEowIBAAKCAQEA1a2b3c\n-----END RSA ', 'PRIVATE KEY-----'),
]

const KEEP: readonly string[] = [
  'commit 79a1e9dd8f3b2c1a4e5d6f7089abcdef01234567 landed on main',
  'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'apps/nextjs/src/components/agentengineer/school/school-styles.ts',
  'http://localhost:3000/api/auth and 127.0.0.1:5432',
  'private net 192.168.1.14 and 10.0.0.7 and 172.16.4.2 and 203.0.113.9',
  'Co-Authored-By: Claude <noreply@anthropic.com>',
  'ray-amjad@users.noreply.github.com',
  'Claude Code 2.1.260 released 2026-09-04',
  'const IN_FLIGHT = new Set([QUEUED, BUILDING, INITIALIZING])',
  'npm install @anthropic-ai/claude-code --save-dev',
  'PLANETSCALE_DATABASE_URL is set in Infisical prod',
  'monthly: "price_1Q4RmZKtVnpLXbYc82F0dTgW", productId: "prod_Rbk7HDpQ2mXvLe"',
  'only promo_1M3KpsDvNrqYTcbG7h2xWzQe is active',
  j('pk_', 'live_', '51H8xQ2LpR7vT4nK9wYbF1cJhE6sAdG0u'),
  'key="archived-modules-marker"',
  'const OUTLINE_OPEN_KEY = "lesson_article_outline_open_v1";',
  'import { playerEventBatchV1Schema } from "./player-event-ingest";',
  'export function randomTimestampWithinLast14Days(): string {',
  'META_Conv_Lookalike-Customers_FreeTrial_2024Q1',
  'const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";',
  'utm_source=youtube&utm_medium=video_description&utm_campaign=dQw4w9WgXcQ',
  'The channel ID is UCq7NmTfKbrWzXd4LpHveAJs (a channel)',
  'placeholder="you@example.com" and name@company.com',
]

test('les secrets, e-mails et IP publiques sont masqués', () => {
  expect(HIDE.filter(text => scrub(text) === text)).toEqual([])
})

test('les identifiants publics, SHA, chemins et adresses locales restent visibles', () => {
  expect(KEEP.filter(text => scrub(text) !== text)).toEqual([])
})

test('une même valeur donne toujours le même repère, qui redonne la valeur', () => {
  const line = `KEY=${ANT}`
  expect(scrub(line)).toBe(scrub(line))
  expect(scrub(line).includes(ANT)).toBe(false)
  expect(restore(scrub(line))).toBe(line)
})

function bottom(on: On, seen: { prompts: string[]; commands: string[]; toasts: string[]; notices: string[] }, stdout: string): void {
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    seen.commands.push(e.command)
    return { result: { stdout, stderr: '', interrupted: false } }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notice', ($, e) => {
    seen.notices.push(e.text ?? '')
    return { value: undefined }
  })
}

test('une clé collée dans le prompt est masquée, puis rendue à la commande, et masquée dans la sortie', async ($, on) => {
  const seen = { prompts: [] as string[], commands: [] as string[], toasts: [] as string[], notices: [] as string[] }
  bottom(on, seen, `ANTHROPIC_API_KEY=${ANT}\n`)

  await $.prompt.submit({ text: `ma clé : ${ANT}`, wait: false, origin: { kind: 'composer' } })
  const shown = seen.prompts[0] ?? ''
  expect(shown.includes(ANT)).toBe(false)
  expect(seen.toasts.length).toBe(1)

  const tag = /\[REDACTED-SECRET-[0-9a-f]{8}\]/.exec(shown)?.[0] ?? ''
  expect(tag === '').toBe(false)
  const r = await $.tool.call({ tool: 'Bash', command: `curl -H "x-api-key: ${tag}" https://api.example.com` })
  expect((seen.commands[0] ?? '').includes(ANT)).toBe(true)
  const out = (r.result as { stdout: string }).stdout
  expect(out.includes(ANT)).toBe(false)
  expect(out.includes(tag)).toBe(true)
  expect(seen.notices.length).toBe(1)
})

test('une sortie sans secret passe telle quelle', async ($, on) => {
  const seen = { prompts: [] as string[], commands: [] as string[], toasts: [] as string[], notices: [] as string[] }
  bottom(on, seen, 'bonjour\n')

  const r = await $.tool.call({ tool: 'Bash', command: 'echo bonjour' })
  expect((r.result as { stdout: string }).stdout).toBe('bonjour\n')
  expect(seen.notices).toEqual([])
})
