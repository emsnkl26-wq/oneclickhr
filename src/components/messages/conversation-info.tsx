'use client'

import * as React from 'react'
import {
  Archive, ArchiveRestore, BellOff, Crown, LogOut, Trash2, UserMinus, UserPlus, X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Avatar, AvatarFallback, AvatarImage,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  Switch,
} from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import { apiDelete, apiPatch, apiPost, ApiClientError } from '@/lib/fetcher'
import { CONVERSATION_POSTING } from '@/lib/schemas'
import type { ConversationDetail, MessagingPerson } from '@/lib/messaging-shared'
import { cn, initials } from '@/lib/utils'
import { PeoplePicker } from '@/components/messages/people-picker'

/**
 * Everything about a conversation that is not a message: who is in it, what it
 * is called, who may post, and the two ways out of it.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY ARCHIVE IS OFFERED ABOVE DELETE, AND WORDED HARDER                  │
 * │                                                                          │
 * │ Deleting a conversation destroys its history for everybody in it, and    │
 * │ there is no undo — the cascades in 062 take the messages, the            │
 * │ attachments and the reactions. Archiving keeps all of it and makes the   │
 * │ room read-only, which is what "we are done with this project" actually   │
 * │ means nine times out of ten.                                            │
 * │                                                                          │
 * │ So archive is a plain button and delete is behind a typed confirmation.   │
 * │ Not a nag: the two actions look similar in a menu and differ entirely in  │
 * │ what survives them.                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * LEAVING IS ALWAYS AVAILABLE, including from a direct message, where deleting
 * is not. A history half of which is somebody else's is not one person's to
 * destroy, and nobody is obliged to stay in a conversation.
 */
export function ConversationInfo({
  open,
  onOpenChange,
  detail,
  people,
  viewerId,
  muted,
  onMutedChange,
  onChanged,
  onLeft,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: ConversationDetail
  /** Everyone in the workspace, for the add-people picker. */
  people: MessagingPerson[]
  viewerId: string
  muted: boolean
  onMutedChange: (muted: boolean) => void
  /** Re-read the conversation after a change the server made. */
  onChanged: () => void
  onLeft: () => void
  onDeleted: () => void
}) {
  const { conversation, members, canManage } = detail
  const isRoom = conversation.kind !== 'direct'

  const [name, setName] = React.useState(conversation.title)
  const [description, setDescription] = React.useState('')
  const [posting, setPosting] = React.useState(conversation.posting)
  const [savingSettings, setSavingSettings] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setName(conversation.title)
    setPosting(conversation.posting)
    setSelected(new Set())
    setAdding(false)
    setConfirmDelete('')
  }, [open, conversation.title, conversation.posting])

  const memberIds = React.useMemo(() => new Set(members.map((member) => member.id)), [members])
  const addable = React.useMemo(
    () => people.filter((person) => person.id !== viewerId),
    [people, viewerId]
  )
  const alreadyIn = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const member of members) map[member.id] = 'Already in this conversation'
    return map
  }, [members])

  const iAmAdmin = members.find((member) => member.id === viewerId)?.memberRole === 'admin'
  const adminCount = members.filter((member) => member.memberRole === 'admin').length

  async function saveSettings() {
    setSavingSettings(true)
    try {
      await apiPatch(`/api/messaging/conversations/${conversation.id}`, {
        name: name.trim(),
        description: description.trim() || undefined,
        posting,
      })
      toast.success('Saved')
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That could not be saved')
    } finally {
      setSavingSettings(false)
    }
  }

  async function addPeople() {
    if (!selected.size) return
    setBusy(true)
    try {
      await apiPost(`/api/messaging/conversations/${conversation.id}/members`, {
        profileIds: Array.from(selected),
      })
      toast.success(selected.size === 1 ? 'Added' : `${selected.size} people added`)
      setSelected(new Set())
      setAdding(false)
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'They could not be added')
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(profileId: string) {
    try {
      await apiDelete(`/api/messaging/conversations/${conversation.id}/members/${profileId}`)
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'They could not be removed')
    }
  }

  async function setRole(profileId: string, role: 'member' | 'admin') {
    try {
      await apiPatch(`/api/messaging/conversations/${conversation.id}/members/${profileId}`, { role })
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That could not be changed')
    }
  }

  async function setArchived(archived: boolean) {
    setBusy(true)
    try {
      await apiPatch(`/api/messaging/conversations/${conversation.id}`, { archived })
      toast.success(archived ? 'Archived' : 'Reopened')
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That could not be changed')
    } finally {
      setBusy(false)
    }
  }

  async function leave() {
    setBusy(true)
    try {
      await apiDelete(`/api/messaging/conversations/${conversation.id}/members/${viewerId}`)
      onOpenChange(false)
      onLeft()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'You could not leave')
    } finally {
      setBusy(false)
    }
  }

  async function destroy() {
    setBusy(true)
    try {
      await apiDelete(`/api/messaging/conversations/${conversation.id}`)
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That could not be deleted')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{conversation.title}</DialogTitle>
          <DialogDescription>
            {conversation.kind === 'direct'
              ? 'A direct conversation between the two of you.'
              : conversation.subtitle}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          {/* Per-reader, so it is offered even in a room nobody can manage. */}
          {!conversation.observerOnly ? (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
              <span className="flex items-center gap-2 text-[13px] text-ink">
                <BellOff className="size-4 text-ink-muted" aria-hidden />
                Mute notifications
                <span className="text-[11px] text-ink-muted">
                  — unread counts still show
                </span>
              </span>
              <Switch checked={muted} onCheckedChange={onMutedChange} />
            </label>
          ) : null}

          {isRoom && canManage ? (
            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold text-ink">Settings</h3>
              <FormField label="Name" htmlFor="info-name">
                <Input
                  id="info-name"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                />
              </FormField>
              <FormField label="Description" htmlFor="info-description">
                <Textarea
                  id="info-description"
                  rows={2}
                  value={description}
                  maxLength={2000}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What this conversation is for"
                />
              </FormField>
              <FormField label="Who can post" htmlFor="info-posting">
                <Select
                  id="info-posting"
                  value={posting}
                  onChange={(event) =>
                    setPosting(event.target.value as (typeof CONVERSATION_POSTING)[number])
                  }
                  options={[
                    { value: 'everyone', label: 'Everyone in the conversation' },
                    { value: 'admins', label: 'Administrators only' },
                  ]}
                />
              </FormField>
              <div className="flex justify-end">
                <Button size="sm" loading={savingSettings} onClick={saveSettings}>
                  Save settings
                </Button>
              </div>
            </section>
          ) : null}

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-ink">
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </h3>
              {isRoom && canManage ? (
                <Button size="sm" variant="secondary" onClick={() => setAdding((now) => !now)}>
                  {adding ? <X /> : <UserPlus />}
                  {adding ? 'Cancel' : 'Add people'}
                </Button>
              ) : null}
            </div>

            {adding ? (
              <div className="space-y-2 rounded-lg border border-line p-2">
                <PeoplePicker
                  people={addable}
                  selected={selected}
                  onToggle={(id) =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    })
                  }
                  disabled={alreadyIn}
                />
                <div className="flex justify-end">
                  <Button size="sm" loading={busy} disabled={!selected.size} onClick={addPeople}>
                    Add {selected.size || ''}
                  </Button>
                </div>
              </div>
            ) : null}

            <ul className="divide-y divide-line rounded-lg border border-line">
              {members.map((member) => (
                <li key={member.id} className="flex items-center gap-2.5 px-3 py-2">
                  <Avatar className="size-8 shrink-0">
                    {member.photoUrl ? <AvatarImage src={member.photoUrl} alt="" /> : null}
                    <AvatarFallback className="bg-brand-600 text-[10px] text-white">
                      {initials(member.name, member.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                        {member.name}
                        {member.id === viewerId ? ' (you)' : ''}
                      </span>
                      {member.memberRole === 'admin' ? (
                        <Crown className="size-3 shrink-0 text-brand-ink" aria-label="Administrator" />
                      ) : null}
                    </span>
                    <span className="block truncate text-[11px] text-ink-muted">
                      {member.jobTitle ?? member.email ?? ''}
                    </span>
                  </span>

                  {isRoom && canManage && member.id !== viewerId ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="focus-ring grid size-7 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-page hover:text-ink"
                        aria-label={`Options for ${member.name}`}
                      >
                        <span className="text-base leading-none">⋯</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            setRole(member.id, member.memberRole === 'admin' ? 'member' : 'admin')
                          }
                        >
                          <Crown />
                          {member.memberRole === 'admin'
                            ? 'Remove as administrator'
                            : 'Make administrator'}
                        </DropdownMenuItem>
                        <DropdownMenuItem destructive onClick={() => removeMember(member.id)}>
                          <UserMinus />
                          Remove from conversation
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              ))}
            </ul>

            {isRoom && iAmAdmin && adminCount === 1 ? (
              <p className="text-[11px] text-ink-muted">
                You are the only administrator. Make somebody else one before you leave.
              </p>
            ) : null}
          </section>

          {isRoom && canManage ? (
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold text-ink">Conversation</h3>
              <Button
                variant="secondary"
                className="w-full justify-start"
                loading={busy}
                onClick={() => setArchived(!conversation.archived)}
              >
                {conversation.archived ? <ArchiveRestore /> : <Archive />}
                {conversation.archived
                  ? 'Reopen — people can post again'
                  : 'Archive — keeps the history, read-only'}
              </Button>

              <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/5 p-3">
                <p className="text-[12px] leading-relaxed text-ink">
                  <strong className="font-semibold">Deleting is permanent.</strong> Every message,
                  photo and voice note in this conversation goes, for everybody in it. Archive
                  instead if you only want it closed.
                </p>
                <Input
                  value={confirmDelete}
                  onChange={(event) => setConfirmDelete(event.target.value)}
                  placeholder={`Type ${conversation.title} to confirm`}
                  aria-label="Type the conversation name to confirm deletion"
                />
                <Button
                  variant="danger"
                  className="w-full"
                  loading={busy}
                  disabled={confirmDelete.trim() !== conversation.title}
                  onClick={destroy}
                >
                  <Trash2 />
                  Delete this conversation
                </Button>
              </div>
            </section>
          ) : null}
        </DialogBody>

        <DialogFooter className={cn('sm:justify-between')}>
          {!conversation.observerOnly ? (
            <Button variant="ghost" className="text-danger" loading={busy} onClick={leave}>
              <LogOut />
              Leave conversation
            </Button>
          ) : (
            <span />
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
