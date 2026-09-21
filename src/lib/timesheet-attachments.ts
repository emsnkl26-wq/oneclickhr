/**
 * A timesheet's files, whichever shape the row was saved in.
 *
 * 044 added `attachments` (a list). A row saved before that — or read before
 * the migration's backfill has run — only has the single `attachment_url`, so
 * that becomes a list of one rather than an empty "no files".
 */
export interface TimesheetAttachment {
  key: string
  name: string
}

export function timesheetAttachments(row: {
  attachments?: unknown
  attachment_url?: string | null
  attachment_name?: string | null
}): TimesheetAttachment[] {
  if (Array.isArray(row.attachments) && row.attachments.length) {
    return row.attachments
      .filter(
        (file): file is TimesheetAttachment =>
          !!file && typeof file.key === 'string' && typeof file.name === 'string'
      )
      .map((file) => ({ key: file.key, name: file.name }))
  }
  return row.attachment_url
    ? [{ key: row.attachment_url, name: row.attachment_name || 'Attachment' }]
    : []
}
