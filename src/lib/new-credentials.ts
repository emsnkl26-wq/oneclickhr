/**
 * The one-time hand-off of a freshly issued employee password, from wherever it
 * was created to the employee's own page where the org actually reads it out.
 *
 * sessionStorage rather than a query parameter: a password in the URL lands in
 * browser history, in the address bar over someone's shoulder, and in any
 * referrer a later request sends. This is per-tab, cleared on read, and never
 * leaves the browser.
 */
export interface NewCredentials {
  email: string
  tempPassword: string | null
  emailSent: boolean
  loginUrl: string
}

const key = (employeeId: string) => `ems:new-credentials:${employeeId}`

export function stashCredentials(employeeId: string, creds: NewCredentials): void {
  try {
    sessionStorage.setItem(key(employeeId), JSON.stringify(creds))
  } catch {
    /* Private mode or a full quota — the page simply offers a new password. */
  }
}

/** Read and remove. Reloading the page must not resurrect the password. */
export function takeCredentials(employeeId: string): NewCredentials | null {
  try {
    const raw = sessionStorage.getItem(key(employeeId))
    if (!raw) return null
    sessionStorage.removeItem(key(employeeId))
    return JSON.parse(raw) as NewCredentials
  } catch {
    return null
  }
}
