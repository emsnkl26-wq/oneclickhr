import { redirect } from 'next/navigation'

/**
 * Moved to `/employee/payroll` (026).
 *
 * The page stopped being "payslips your employer uploaded" and became "confirm
 * you were paid", which is a different enough thing to deserve a different
 * address. This redirect exists because the old one is in people's history and
 * their bookmarks, and a 404 on a payslips link is exactly the kind of thing
 * that makes someone think their records are gone.
 */
export default function EmployeePayslipsPage() {
  redirect('/employee/payroll')
}
