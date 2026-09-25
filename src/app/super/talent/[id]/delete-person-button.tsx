'use client'

import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DeleteUserDialog, type DeletableUser } from '../../delete-user-dialog'

export function DeletePersonButton({ user }: { user: DeletableUser }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        <Trash2 />
        Delete permanently
      </Button>
      <DeleteUserDialog user={open ? user : null} onClose={() => setOpen(false)} afterDelete="/super/talent" />
    </>
  )
}
