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

  const toggle = React.useCallback((profileId: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (mode === 'direct') {
        // One person, by definition. Tapping a second REPLACES the first rather
        // than refusing it, which is what a radio list should do.
        next.clear()
        if (!current.has(profileId)) next.add(profileId)
        return next
      }
      if (next.has(profileId)) next.delete(profileId)
      else next.add(profileId)
      return next
    })
  }, [mode])

  const chosenProject = projects.find((project) => project.id === projectId) ?? null

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

  const ready =
    mode === 'direct'
      ? selected.size === 1
      : mode === 'group'
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
                  // The room's default name is the project's — nobody wants to
                  // retype it, and a differently named room for the same
                  // project is how two places end up meaning one thing.
                  if (project && !project.conversationId) setName(project.name)
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
                onToggle={toggle}
                max={mode === 'direct' ? 1 : undefined}
                emptyLabel="Nobody in this workspace matches that."
              />
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} loading={busy} disabled={!ready}>
            {chosenProject?.conversationId
              ? 'Open room'
              : mode === 'direct'
                ? 'Start messaging'
                : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
