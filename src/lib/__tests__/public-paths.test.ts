import { describe, it, expect } from 'vitest'
import { canonicalMachinePath, isPublicPath, MACHINE_PATHS, PUBLIC_PATHS } from '@/lib/auth/public-paths'

/**
 * These tests exist because of a real production outage: the Supabase "Send
 * Email" hook was not on the public list, so middleware answered its POST with a
 * 307 to /login. The sender followed the redirect as a GET, the handler never
 * ran, and because a failing send hook ABORTS the auth action, every single
 * sign-up on production died with an unexplained error.
 */
describe('middleware public paths', () => {
  it('lets every machine caller through — none of them can hold a session cookie', () => {
    for (const path of MACHINE_PATHS) {
      expect(isPublicPath(path), `${path} must be public`).toBe(true)
    }
  })

  it('keeps the send-email hook public (sign-up and password reset both depend on it)', () => {
    expect(isPublicPath('/api/auth/send-email-hook')).toBe(true)
  })

  it('lets a signed-out visitor reach the auth pages and their endpoints', () => {
    for (const path of ['/login', '/employee-login', '/signup', '/forgot-password', '/auth/confirm']) {
      expect(isPublicPath(path), `${path} must be public`).toBe(true)
    }
    for (const path of ['/api/auth/login', '/api/auth/signup', '/api/auth/forgot-password']) {
      expect(isPublicPath(path), `${path} must be public`).toBe(true)
    }
  })

  it('matches sub-paths of a public namespace', () => {
    expect(isPublicPath('/api/cron/visa-reminders')).toBe(true)
    expect(isPublicPath('/auth/confirm/anything')).toBe(true)
  })

  it('does not hand a free pass to a path that merely starts with a public one', () => {
    for (const path of ['/login-evil', '/signupx', '/api/auth/send-email-hook-evil', '/api/cronjob']) {
      expect(isPublicPath(path), `${path} must NOT be public`).toBe(false)
    }
  })

  it('keeps the protected areas protected', () => {
    for (const path of ['/org', '/employee', '/super', '/org/employees', '/api/employees']) {
      expect(isPublicPath(path), `${path} must NOT be public`).toBe(false)
    }
  })

  /*
   * The job portal is the first surface in this product that is public on
   * purpose. These two tests are a pair and neither is much use alone: the first
   * says the portal is reachable, the second says the ADMIN half of the same
   * feature is not. Getting the second wrong publishes every draft posting and
   * every applicant's CV to the internet.
   */
  it('opens the public job portal to anyone', () => {
    for (const path of [
      '/jobs',
      '/jobs/9d0b0d3a-6f4a-4a3b-9c2e-0a1b2c3d4e5f',
      '/jobs/company/acme',
      '/api/jobs/apply',
      '/api/jobs/resume-presign',
      '/api/jobs/logo',
      '/robots.txt',
      '/sitemap.xml',
    ]) {
      expect(isPublicPath(path), `${path} must be public`).toBe(true)
    }
  })

  it('does NOT open the admin half of the jobs feature', () => {
    for (const path of [
      '/org/jobs',
      '/org/jobs/9d0b0d3a-6f4a-4a3b-9c2e-0a1b2c3d4e5f',
      '/super/jobs',
      '/api/org/jobs',
      '/api/super/jobs',
      '/employee/applications',
      // Near-misses that must not inherit the portal's free pass.
      '/jobs-evil',
      '/jobsx',
    ]) {
      expect(isPublicPath(path), `${path} must NOT be public`).toBe(false)
    }
  })

  it('exposes no duplicates', () => {
    expect(new Set(PUBLIC_PATHS).size).toBe(PUBLIC_PATHS.length)
  })
})

describe('trailing-slash tolerance for machine endpoints', () => {
  it('maps a trailing-slash hook URL back to the real route', () => {
    expect(canonicalMachinePath('/api/auth/send-email-hook/')).toBe('/api/auth/send-email-hook')
    expect(canonicalMachinePath('/api/cron/')).toBe('/api/cron')
  })

  it('leaves everything else alone', () => {
    expect(canonicalMachinePath('/api/auth/send-email-hook')).toBeNull()
    expect(canonicalMachinePath('/org/')).toBeNull()
    expect(canonicalMachinePath('/')).toBeNull()
    expect(canonicalMachinePath('/api/auth/send-email-hook/extra/')).toBeNull()
  })
})
