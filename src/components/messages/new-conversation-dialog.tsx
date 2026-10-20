'use client'

import * as React from 'react'
import { Briefcase, MessageSquare, Users } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { CONVERSATION_POSTING } from '@/lib/schemas'
import type { MessagingPerson } from '@/lib/messaging-shared'
import { cn } from '@/lib/utils'
import { PeoplePicker } from '@/components/messages/people-picker'

export interface ProjectOption {
  id: string
  code: string
  name: string
  /** Already has a room — offered, but as the room it already is. */
  conversationId: string | null
  /** The project's assignees (profile ids, viewer excluded) — the room's default roster. */
  memberIds: string[]
}

type Mode = 'direct' | 'group' | 'project'

/**
 * Start a conversation.
 *
 * THREE MODES IN ONE DIALOG rather than three entry points, because the
 * decision ("who am I talking to?") is the same decision in all three and
 * splitting it across three buttons makes somebody choose a data model before
 * they have chosen a person.
 *
 * A PROJECT ROOM THAT ALREADY EXISTS IS OPENED, NOT REFUSED. The unique index
 * in 062 allows one room per project, so offering the project and then failing
 * would be a dead end; the option says "open" and navigates instead.
 *
 * Only somebody who RUNS a project is offered the project mode — the policy
 * refuses anybody else anyway (`conversations_insert`), and a tab whose every
 * option returns 403 is worse than no tab.
 */
export function NewConversationDialog({
  open,
  onOpenChange,
  people,
  projects,
  canCreateProjectRoom,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Everyone in the workspace except the viewer. */
  people: MessagingPerson[]
  projects: ProjectOption[]
  canCreateProjectRoom: boolean
  onCreated: (conversationId: string) => void
}) {
  const [mode, setMode] = React.useState<Mode>('direct')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [posting, setPosting] = React.useState<(typeof CONVERSATION_POSTING)[number]>('everyone')
  const [projectId, setProjectId] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  // A reopened dialog is a fresh one. Carrying the last attempt's half-filled
  // group into a new "message somebody" is the sort of state nobody expects.
  React.useEffect(() => {
    if (!open) return
    setMode('direct')
    setSelected(new Set())
    setName('')
    setDescription('')
    setPosting('everyone')
    setProjectId('')
  }, [open])

  // Add or remove one person from a group's / room's roster. A direct message
  // does not come through here — it opens on the tap (`startDirect`).
  const toggle = React.useCallback((profileId: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(profileId)) next.delete(profileId)
      else next.add(profileId)
      return next
    })
  }, [])

  const chosenProject = projects.find((project) => project.id === projectId) ?? null

  /**
   * Start a direct message in one tap.
   *
   * A DM has exactly one recipient, so there is nothing to confirm: picking the
   * person IS the decision, and a second "Start messaging" click is a step that
   * only ever means "yes, the person I just chose". Clicking a row creates (or
   * reopens) the thread and lands in it.
   */
  async function startDirect(profileId: string) {
    if (busy) return
    setBusy(true)
    try {
      const result = await apiPost<{ id: string; created: boolean }>(
        '/api/messaging/conversations',
        { kind: 'direct', withProfileId: profileId }
      )
      onCreated(result.id)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That conversation could not be opened')
    } finally {
      setBusy(false)
    }
  }

  async function create() {
    if (mode === 'project' && chosenProject?.conversationId) {
      onCreated(chosenProject.conversationId)
      onOpenChange(false)
      return
    }

    setBusy(true)
    try {
      const result = await apiPost<{ id: string; created: boolean }>(
        '/api/messaging/conversations',
        mode === 'direct'
          ? { kind: 'direct', withProfileId: Array.from(selected)[0] }
          : {
              kind: mode,
              name: name.trim(),
              description: description.trim() || undefined,
              posting,
              projectId: mode === 'project' ? projectId : undefined,
              memberIds: Array.from(selected),
            }
      )
      onCreated(result.id)
      onOpenChange(false)
      if (mode !== 'direct' && result.created) {
        toast.success(mode === 'project' ? 'Project room created' : 'Group created')
      }
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That could not be created')
    } finally {
      setBusy(false)
    }
  }

  // Whether the Create / Open action is allowed. Direct messages have no such
  // button — they open on the tap — so this only governs groups and rooms.
  const ready =
    mode === 'group'
      ? !!name.trim()
      : !!projectId && (!!chosenProject?.conversationId || !!name.trim())

  const tabs: Array<{ id: Mode; label: string; icon: typeof Users }> = [
    { id: 'direct', label: 'Direct', icon: MessageSquare },
    { id: 'group', label: 'Group', icon: Users },
    ...(canCreateProjectRoom
      ? [{ id: 'project' as Mode, label: 'Project room', icon: Briefcase }]
      : []),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>
            Message one person, start a group, or open a room for a project.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div role="tablist" className="flex gap-1 rounded-lg bg-page p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={mode === tab.id}
                onClick={() => {
                  setMode(tab.id)
                  setSelected(new Set())
                }}
                className={cn(
                  'focus-ring flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                  mode === tab.id ? 'bg-card text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                )}
              >
                <tab.icon className="size-4" aria-hidden />
                {tab.label}
              </button>
            ))}
          </div>

          {mode === 'project' ? (
            <FormField label="Project" htmlFor="conversation-project">
              <Select
                id="conversation-project"
                value={projectId}
                onChange={(event) => {
                  const next = event.target.value
                  setProjectId(next)
                  const project = projects.find((candidate) => candidate.id === next)
                  if (project && !project.conversationId) {
                    // The room's default name is the project's — nobody wants to
                    // retype it, and a differently named room for the same
                    // project is how two places end up meaning one thing.
                    setName(project.name)
                    // The project's own people are ticked by default — the room
                    // is for them — but they are only a starting point: anyone
                    // can be unticked before the room is created.
                    setSelected(new Set(project.memberIds))
                  } else {
                    setSelected(new Set())
                  }
                }}
                options={[
                  { value: '', label: 'Choose a project' },
                  ...projects.map((project) => ({
                    value: project.id,
                    label: project.conversationId
                      ? `${project.code} · ${project.name} — open existing room`
                      : `${project.code} · ${project.name}`,
                  })),
                ]}
              />
            </FormField>
          ) : null}

          {mode !== 'direct' && !chosenProject?.conversationId ? (
            <>
              <FormField label="Name" htmlFor="conversation-name">
                <Input
                  id="conversation-name"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={mode === 'project' ? 'Project room' : 'e.g. Payroll team'}
                />
              </FormField>
              <FormField label="Description" htmlFor="conversation-description">
                <Textarea
                  id="conversation-description"
                  rows={2}
                  value={description}
                  maxLength={2000}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What this conversation is for"
                />
              </FormField>
              <FormField
                label="Who can post"
                htmlFor="conversation-posting"
                hint="Choose administrators only for an announcement room."
              >
                <Select
                  id="conversation-posting"
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
            </>
          ) : null}

          {chosenProject?.conversationId ? (
            <p className="rounded-lg bg-page px-3 py-2 text-[13px] text-ink-muted">
              {chosenProject.name} already has a room. Opening it.
            </p>
          ) : (
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink">
                {mode === 'direct' ? 'Who do you want to message?' : 'Add people'}
              </p>
              {mode === 'project' ? (
                <p className="mb-1.5 text-[12px] text-ink-muted">
                  Everyone assigned to the project joins automatically. Add anybody else here.
                </p>
              ) : null}
              <PeoplePicker
                people={people}
                selected={selected}
                onToggle={mode === 'direct' ? startDirect : toggle}
                instant={mode === 'direct'}
                emptyLabel="Nobody in this workspace matches that."
              />
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {/* A direct message needs no confirm button — a tap on the person
              opens the thread. The others gather a roster first, so they keep
              their Create (or Open) action. */}
          {mode === 'direct' ? null : (
            <Button onClick={create} loading={busy} disabled={!ready}>
              {chosenProject?.conversationId ? 'Open room' : 'Create'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
