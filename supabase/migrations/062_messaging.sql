-- ============================================================================
-- 062_messaging.sql — team messaging. Direct messages, groups, project rooms.
--
-- WHAT THIS IS FOR. Until now a workspace that wanted to talk to itself left
-- the product: a timesheet is approved here and discussed on WhatsApp, where
-- the org has no record, no roster and no way to remove a leaver from the
-- conversation. This is that conversation, inside the workspace, with the same
-- tenancy guarantees as everything else in the schema.
--
-- FIVE TABLES
--   conversations        a direct message, a group, or a project room
--   conversation_members who is in it, and what they have read
--   messages             what was said, with soft deletes and edits
--   message_attachments  an image, a file or a voice note on a message
--   message_reactions    one emoji, one person, one message
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ THE PRIVACY DECISION, STATED ONCE                                        │
-- │                                                                          │
-- │ An org administrator CANNOT READ a conversation they are not a member    │
-- │ of. Not a direct message between two employees, not a group they were    │
-- │ never added to. This is the opposite of how every other table here       │
-- │ works — `app.is_org()` normally sees its whole tenant — and it is        │
-- │ deliberate: a messaging feature the employer reads over your shoulder    │
-- │ is a messaging feature nobody uses, and the org would be back on         │
-- │ WhatsApp within a week with none of its records.                         │
-- │                                                                          │
-- │ What the org DOES get is custody, not content:                           │
-- │   • it sees that a group exists, its name and its roster (never a DM's)  │
-- │   • it may add to, remove from, rename, archive and delete a GROUP       │
-- │   • every membership change writes a visible system message, so joining  │
-- │     a room to read it is something the room can see happening            │
-- │   • a direct message's roster is FROZEN: nobody is ever added to one,    │
-- │     org included (`tg_conversation_members_guard`)                       │
-- │                                                                          │
-- │ Super admin gets NOTHING here. The platform's read-only cross-tenant     │
-- │ bypass exists for metrics and account state; it stops at customers'      │
-- │ private conversations, exactly as it already stops at their payslips.    │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- WHY UNREAD IS A TIMESTAMP, NOT A COUNTER. `conversation_members.last_read_at`
-- plus a counting query beats a maintained `unread_count` column for the same
-- reason the board's checklist progress is computed rather than stored: a
-- counter needs a trigger per RECIPIENT on every insert, which turns one
-- message into N row locks on the hottest table in the feature — and still has
-- to be reconciled when somebody is added to a room that already has history.
-- `messaging_unread()` answers the whole badge in one indexed query instead.
--
-- WHY `last_message_at` IS DENORMALIZED ANYWAY. The conversation list sorts by
-- it and shows a preview, and the alternative is a correlated subquery per row
-- every time the list renders. It is written by one after-write trigger and is
-- never read as truth — the messages are the truth.
--
-- WHY ATTACHMENTS ARE A TABLE AND NOT A `jsonb` COLUMN. `/api/files/view` has
-- to answer "does a row this caller may SELECT reference this storage key?" for
-- every image in a thread. Against a column that is an indexed equality
-- (`storage_key = $1`) under RLS — the same shape the payslip and document
-- checks already use. Against a jsonb array it is a containment query nobody
-- will get right twice.
--
-- NO LINK UNFURLING. Links are detected and rendered in the browser. The server
-- never fetches a URL a user typed: that is an SSRF primitive pointed at the
-- workspace's own network, and a preview card is not worth it.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.conversation_kind as enum ('direct', 'group', 'project');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Who may post. A room an org uses for announcements wants 'admins'.
  create type public.conversation_posting as enum ('everyone', 'admins');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.conversation_member_role as enum ('member', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  -- The DOMINANT content of a message, so a list preview or a push can say
  -- "Photo" or "Voice message" without joining the attachments.
  create type public.message_kind as enum ('text', 'image', 'file', 'voice', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attachment_kind as enum ('image', 'video', 'audio', 'file');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. conversations
--
-- `direct_key` is what makes "message this person" idempotent. It is the two
-- profile ids sorted and joined, and it is unique per tenant — so two people
-- who open a DM with each other at the same instant end up in ONE
-- conversation, and the loser of the race gets a unique violation its route
-- turns into a select.
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  kind               public.conversation_kind not null,
  -- Null for a direct message: its name is whoever the other person is, and
  -- storing one would be storing it from one side's point of view.
  name               text check (name is null or length(btrim(name)) between 1 and 120),
  description        text check (description is null or length(description) <= 2000),
  color              text not null default '#2563EB' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- An R2 object key, never a URL. Same rule as tenants.logo_url.
  avatar_url         text,
  project_id         uuid,
  posting            public.conversation_posting not null default 'everyone',
  created_by         uuid references public.profiles(id) on delete set null,
  archived_at        timestamptz,
  -- Written by tg_messages_after_write. Defaults to creation so a brand-new
  -- room sorts to the top of the list before anybody has said anything.
  last_message_at    timestamptz not null default now(),
  last_message_text  text,
  last_message_by    text,
  last_message_kind  public.message_kind,
  direct_key         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- A group and a project room are named; a direct message is not.
  constraint conversations_name_ck check (
    (kind = 'direct' and name is null) or (kind <> 'direct' and name is not null)
  ),
  constraint conversations_project_ck check (
    (kind = 'project' and project_id is not null) or (kind <> 'project' and project_id is null)
  ),
  constraint conversations_direct_key_ck check (
    (kind = 'direct') = (direct_key is not null)
  ),
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id) on delete cascade
);

do $$ begin
  alter table public.conversations add constraint conversations_id_tenant_uq unique (id, tenant_id);
exception when duplicate_object then null; end $$;

create unique index if not exists conversations_direct_uq
  on public.conversations (tenant_id, direct_key) where direct_key is not null;

-- One room per project. A second would split the project's history in two.
create unique index if not exists conversations_project_uq
  on public.conversations (tenant_id, project_id) where project_id is not null;

create index if not exists conversations_tenant_recent_idx
  on public.conversations (tenant_id, last_message_at desc);

drop trigger if exists set_updated_at on public.conversations;
create trigger set_updated_at before update on public.conversations
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. conversation_members
--
-- Composite foreign keys both ways, as 018/038: a membership row can bind
-- neither another tenant's conversation nor another tenant's person, for every
-- writer including the service role.
--
-- `muted` silences the push and the email, never the unread count. Hiding the
-- count is how people miss things they asked to be quiet rather than invisible.
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_members (
  conversation_id uuid not null,
  profile_id      uuid not null,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  role            public.conversation_member_role not null default 'member',
  last_read_at    timestamptz,
  muted           boolean not null default false,
  pinned          boolean not null default false,
  added_by        uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, profile_id),
  foreign key (conversation_id, tenant_id) references public.conversations (id, tenant_id) on delete cascade,
  foreign key (profile_id, tenant_id)      references public.profiles (id, tenant_id)      on delete cascade
);

-- The sidebar's "my conversations" query, and the badge's.
create index if not exists conversation_members_profile_idx
  on public.conversation_members (profile_id);
create index if not exists conversation_members_tenant_idx
  on public.conversation_members (tenant_id);

-- ---------------------------------------------------------------------------
-- 4. messages
--
-- `sender_name` and `sender_role` are SNAPSHOTS, written once, for the same
-- reason `task_comments` snapshots them: a thread has to still read correctly
-- after the person who wrote it has left and the profile join comes back empty.
--
-- DELETES ARE SOFT. `deleted_at` is set and the body is blanked by the route;
-- the row stays so the thread keeps its shape, replies to it still resolve, and
-- "this message was deleted" is something the reader can see rather than a gap
-- they have to notice. There is no DELETE policy at all — see §10.
--
-- `mentions` is the set of profile ids an `@` in the body named. A column
-- rather than a re-parse at read time, because the NOTIFIER needs it
-- server-side: parsing the same text twice in two languages is how a mention
-- notifies somebody the thread never highlighted.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null,
  sender_id       uuid references public.profiles(id) on delete set null,
  sender_name     text,
  sender_role     text,
  kind            public.message_kind not null default 'text',
  body            text check (body is null or length(body) <= 8000),
  reply_to_id     uuid,
  mentions        uuid[] not null default '{}',
  edited_at       timestamptz,
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id) on delete set null,
  pinned_at       timestamptz,
  pinned_by       uuid references public.profiles(id) on delete set null,
  -- Set by the sender's client so a message it has already drawn optimistically
  -- can be matched to the row that comes back, instead of appearing twice.
  client_token    text check (client_token is null or length(client_token) <= 64),
  system_event    text check (system_event is null or length(system_event) <= 64),
  system_meta     jsonb,
  created_at      timestamptz not null default now(),
  foreign key (conversation_id, tenant_id) references public.conversations (id, tenant_id) on delete cascade,
  -- Tenant-carrying self reference: a reply can never point at another tenant's
  -- message. Nulls out rather than cascading — losing the quoted message must
  -- not delete the answer to it.
  foreign key (reply_to_id, tenant_id) references public.messages (id, tenant_id) on delete set null
);

do $$ begin
  alter table public.messages add constraint messages_id_tenant_uq unique (id, tenant_id);
exception when duplicate_object then null; end $$;

-- A system message has no author and says what happened; everything else has an
-- author and says something. The check keeps the two from blurring.
do $$ begin
  alter table public.messages add constraint messages_system_ck check (
    (kind = 'system') = (system_event is not null)
  );
exception when duplicate_object then null; end $$;

-- A message says SOMETHING. A text message with no text is a client bug, not a
-- thing to store; an image or voice message carries its content in its
-- attachment row, so only `text` is constrained here.
do $$ begin
  alter table public.messages add constraint messages_content_ck check (
    kind <> 'text' or (body is not null and length(btrim(body)) > 0)
  );
exception when duplicate_object then null; end $$;

-- The thread's own query: one conversation, newest first.
create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists messages_tenant_idx on public.messages (tenant_id);
create index if not exists messages_sender_idx on public.messages (sender_id);
-- Resolving a quoted message, and finding the replies to one.
create index if not exists messages_reply_idx on public.messages (reply_to_id)
  where reply_to_id is not null;
-- The pinned-messages panel.
create index if not exists messages_pinned_idx on public.messages (conversation_id, pinned_at desc)
  where pinned_at is not null;
/*
 * Idempotent sends. A flaky connection retries a POST whose first attempt
 * actually landed; without this the room gets the message twice and no amount
 * of client bookkeeping can tell which one to drop.
 */
create unique index if not exists messages_client_token_uq
  on public.messages (conversation_id, sender_id, client_token)
  where client_token is not null;

/*
 * Search. `simple` rather than `english` on purpose: this text is multilingual
 * and full of names and product nouns, and an English stemmer turns "Nextkin"
 * and "invoicing" into guesses. The index and the query must agree on the
 * configuration or the index is not used, so the config is named in both places
 * — here, and in `lib/messaging.ts`'s `textSearch` call.
 */
create index if not exists messages_body_fts_idx
  on public.messages using gin (to_tsvector('simple', coalesce(body, '')));

-- ---------------------------------------------------------------------------
-- 5. message_attachments
-- ---------------------------------------------------------------------------
create table if not exists public.message_attachments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  conversation_id  uuid not null,
  message_id       uuid not null,
  kind             public.attachment_kind not null,
  -- The R2 object key. NEVER a URL — reads go through /api/files/view, which
  -- re-authorizes and mints a short-lived signature.
  storage_key      text not null,
  file_name        text not null check (length(file_name) between 1 and 300),
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes >= 0),
  -- Voice notes and video. Milliseconds would be false precision on a
  -- MediaRecorder blob.
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 7200),
  width            integer check (width is null or width between 1 and 20000),
  height           integer check (height is null or height between 1 and 20000),
  created_at       timestamptz not null default now(),
  foreign key (message_id, tenant_id)      references public.messages (id, tenant_id)      on delete cascade,
  foreign key (conversation_id, tenant_id) references public.conversations (id, tenant_id) on delete cascade
);

create index if not exists message_attachments_message_idx on public.message_attachments (message_id);
-- The one question `/api/files/view` asks: is this key referenced by a row I
-- am allowed to see?
create index if not exists message_attachments_key_idx on public.message_attachments (storage_key);
create index if not exists message_attachments_conversation_idx
  on public.message_attachments (conversation_id, created_at desc);
create index if not exists message_attachments_tenant_idx on public.message_attachments (tenant_id);

-- ---------------------------------------------------------------------------
-- 6. message_reactions
--
-- The primary key is the uniqueness rule: one person, one emoji, one message.
-- Reacting twice with the same emoji is a no-op (`on conflict do nothing`) and
-- un-reacting is a delete, which is why there is no toggle column.
-- ---------------------------------------------------------------------------
create table if not exists public.message_reactions (
  message_id      uuid not null,
  profile_id      uuid not null,
  emoji           text not null check (length(emoji) between 1 and 16),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null,
  created_at      timestamptz not null default now(),
  primary key (message_id, profile_id, emoji),
  foreign key (message_id, tenant_id)      references public.messages (id, tenant_id)      on delete cascade,
  foreign key (profile_id, tenant_id)      references public.profiles (id, tenant_id)      on delete cascade,
  foreign key (conversation_id, tenant_id) references public.conversations (id, tenant_id) on delete cascade
);

create index if not exists message_reactions_message_idx on public.message_reactions (message_id);
create index if not exists message_reactions_tenant_idx  on public.message_reactions (tenant_id);

-- ---------------------------------------------------------------------------
-- 7. app helpers
--
-- Every membership question is a SECURITY DEFINER function in `app`, as 010 and
-- 038 established, so a policy on `conversation_members` can ask "is the caller
-- a member?" without re-entering its own table.
-- ---------------------------------------------------------------------------

/** The two profile ids of a direct conversation, sorted — its identity. */
create or replace function app.direct_key(p_a uuid, p_b uuid)
returns text
language sql
immutable
as $$
  select case when p_a <= p_b
           then p_a::text || ':' || p_b::text
           else p_b::text || ':' || p_a::text
         end;
$$;

/** Is the caller in this conversation? */
create or replace function app.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.conversation_members cm
     where cm.conversation_id = p_conversation_id and cm.profile_id = auth.uid()
  );
$$;

/** Does the caller run this conversation — its own admin, or an org admin? */
create or replace function app.is_conversation_admin(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
      from public.conversations c
      left join public.conversation_members cm
        on cm.conversation_id = c.id and cm.profile_id = auth.uid()
     where c.id = p_conversation_id
       and c.tenant_id = app.current_tenant_id()
       and app.is_active_member()
       and (
         cm.role = 'admin'
         -- A workspace administrator may run any ROOM. Never a direct message:
         -- it has no administrator, by construction.
         or (app.is_org() and c.kind <> 'direct')
       )
  );
$$;

/**
 * May the caller READ this conversation?
 *
 * Membership, and nothing else. See the privacy box at the top of this file for
 * why `app.is_org()` is absent, and why `app.is_super_admin()` is too.
 */
create or replace function app.can_read_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select app.is_active_member()
     and exists (
       select 1
         from public.conversation_members cm
         join public.conversations c on c.id = cm.conversation_id
        where cm.conversation_id = p_conversation_id
          and cm.profile_id = auth.uid()
          and c.tenant_id = app.current_tenant_id()
     );
$$;

/**
 * May the caller POST here?
 *
 * Read access, plus the room is not archived, plus the posting policy admits
 * them. An archived room is readable history and nothing else — that is what
 * archiving means, and enforcing it only in the UI would make it a suggestion.
 */
create or replace function app.can_post_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select app.is_active_member()
     and exists (
       select 1
         from public.conversation_members cm
         join public.conversations c on c.id = cm.conversation_id
        where cm.conversation_id = p_conversation_id
          and cm.profile_id = auth.uid()
          and c.tenant_id = app.current_tenant_id()
          and c.archived_at is null
          and (c.posting = 'everyone' or cm.role = 'admin' or (app.is_org() and c.kind <> 'direct'))
     );
$$;

revoke all on all functions in schema app from anon, public;
grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------------

/**
 * Validate `direct_key` rather than trust it.
 *
 * The route computes it with `app.direct_key()`, which is the only supported
 * way to produce one. This trigger refuses anything that is not two uuids in
 * sorted order, because a malformed key defeats the unique index that makes
 * "open a DM with this person" idempotent — and a defeated unique index shows
 * up as two half-conversations, not as an error.
 */
create or replace function public.tg_conversations_direct_key()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'direct' then
    if new.direct_key is null
       or new.direct_key !~ '^[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$'
       or split_part(new.direct_key, ':', 1) > split_part(new.direct_key, ':', 2) then
      raise exception 'a direct conversation needs a sorted "a:b" direct_key';
    end if;
  else
    new.direct_key := null;
  end if;
  return new;
end;
$$;

drop trigger if exists conversations_direct_key on public.conversations;
create trigger conversations_direct_key before insert or update on public.conversations
  for each row execute function public.tg_conversations_direct_key();

/**
 * Keep the conversation's list row current.
 *
 * The preview is TRUNCATED here rather than at read time, so the list query
 * never pulls 8KB of message body per row.
 *
 * It re-reads the newest surviving message rather than copying NEW, and that is
 * the whole reason it fires on UPDATE too: retracting the last message has to
 * rewrite the preview, or "sure, see you at 4" stays in the sidebar after its
 * sender took it back — the one place a soft delete must not leak.
 */
create or replace function public.tg_messages_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_last public.messages%rowtype;
begin
  select m.* into v_last
    from public.messages m
   where m.conversation_id = new.conversation_id
     and m.deleted_at is null
   order by m.created_at desc, m.id desc
   limit 1;

  update public.conversations c
     set last_message_at   = coalesce(v_last.created_at, c.created_at),
         last_message_text = case
                               when v_last.id is null then null
                               when v_last.kind = 'system' then v_last.body
                               when v_last.body is not null and btrim(v_last.body) <> ''
                                 then left(v_last.body, 180)
                               when v_last.kind = 'image' then 'Photo'
                               when v_last.kind = 'voice' then 'Voice message'
                               when v_last.kind = 'file'  then 'Attachment'
                               else null
                             end,
         last_message_by   = v_last.sender_name,
         last_message_kind = v_last.kind
   where c.id = new.conversation_id;

  return null;
end;
$$;

drop trigger if exists messages_after_write on public.messages;
create trigger messages_after_write after insert or update on public.messages
  for each row execute function public.tg_messages_after_write();

/**
 * What an UPDATE on a message is allowed to be.
 *
 * Three things and no others: editing the body, retracting it, pinning it.
 * Everything else — who sent it, which conversation it is in, when it was sent,
 * which message it answers — is history. An UPDATE policy cannot express
 * "these columns only", because `with check` cannot see OLD. So the rule lives
 * here, once, and applies to every writer including the service role.
 */
create or replace function public.tg_messages_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id <> old.id
     or new.tenant_id       <> old.tenant_id
     or new.conversation_id <> old.conversation_id
     or new.created_at      <> old.created_at
     or new.sender_id    is distinct from old.sender_id
     or new.reply_to_id  is distinct from old.reply_to_id
     or new.kind         is distinct from old.kind
     or new.client_token is distinct from old.client_token then
    raise exception 'a message''s origin cannot be changed';
  end if;
  -- A retraction is final. Re-editing a deleted message would resurrect text
  -- the thread has already been told is gone.
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'a deleted message cannot be restored';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before update on public.messages
  for each row execute function public.tg_messages_guard();

/**
 * What a membership row may become.
 *
 * Two holes this closes, neither of which RLS alone can:
 *
 *   1. SELF-PROMOTION. The UPDATE policy has to let a member write their own
 *      row — that is where `last_read_at`, `muted` and `pinned` live — and
 *      `with check` cannot compare against OLD, so without this a member could
 *      set their own `role` to 'admin' and inherit the room.
 *
 *   2. JOINING A DIRECT MESSAGE. A DM's roster is the two people in it,
 *      forever. An org admin legitimately may add members to every other kind
 *      of room, so the rule cannot live in the INSERT policy's role test; it
 *      lives here and applies to the service role too.
 */
create or replace function public.tg_conversation_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_kind  public.conversation_kind;
  v_count integer;
begin
  select kind into v_kind from public.conversations where id = new.conversation_id;

  if tg_op = 'INSERT' and v_kind = 'direct' then
    select count(*) into v_count
      from public.conversation_members
     where conversation_id = new.conversation_id;
    -- The two rows the creating transaction writes ARE the roster. A third is
    -- somebody being let into a private conversation.
    if v_count >= 2 then
      raise exception 'a direct conversation cannot gain members';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.role is distinct from old.role
     and not app.is_conversation_admin(new.conversation_id) then
    raise exception 'only a conversation administrator can change a member''s role';
  end if;

  return new;
end;
$$;

drop trigger if exists conversation_members_guard on public.conversation_members;
create trigger conversation_members_guard before insert or update on public.conversation_members
  for each row execute function public.tg_conversation_members_guard();

/**
 * A project's room follows the project's roster.
 *
 * Being assigned to a project is how somebody gets into its conversation, and
 * being taken off it is how they leave — otherwise every project room would
 * need its membership maintained twice, by hand, and the second copy would be
 * the one that is wrong. Administrators keep their own rows: `role = 'admin'`
 * is not assignment-derived, so losing an assignment they may never have had
 * does not remove them.
 *
 * Isolated the way 038 isolated its courtesy writes: a failure here must never
 * roll back the assignment it describes.
 */
create or replace function public.tg_project_assignment_sync_room()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_room uuid;
  v_row  public.project_assignments%rowtype;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;

  begin
    select id into v_room
      from public.conversations
     where project_id = v_row.project_id and tenant_id = v_row.tenant_id;

    if v_room is null then
      return null;
    end if;

    if tg_op = 'INSERT' then
      insert into public.conversation_members (conversation_id, profile_id, tenant_id, added_by)
      values (v_room, v_row.employee_id, v_row.tenant_id, auth.uid())
      on conflict do nothing;
    else
      delete from public.conversation_members
       where conversation_id = v_room
         and profile_id = v_row.employee_id
         and role <> 'admin';
    end if;
  exception when others then
    raise warning '[conversations] project room sync for % on %: %',
      v_row.employee_id, v_row.project_id, sqlerrm;
  end;

  return null;
end;
$$;

drop trigger if exists project_assignment_sync_room on public.project_assignments;
create trigger project_assignment_sync_room after insert or delete on public.project_assignments
  for each row execute function public.tg_project_assignment_sync_room();

-- ---------------------------------------------------------------------------
-- 9. The unread query
--
-- One round trip for the whole sidebar: every conversation the caller is in,
-- how many messages in it they have not seen, and when it last moved.
--
-- SECURITY DEFINER, but pinned to `auth.uid()` in the WHERE clause, so it can
-- only ever answer for the caller. Own messages never count — a message you
-- sent is a message you have read — and neither do system lines, because
-- "X added Y" is not news somebody has to come back for.
-- ---------------------------------------------------------------------------
create or replace function public.messaging_unread()
returns table (conversation_id uuid, unread bigint, last_message_at timestamptz)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select cm.conversation_id,
         (
           select count(*)
             from public.messages m
            where m.conversation_id = cm.conversation_id
              and m.deleted_at is null
              and m.kind <> 'system'
              and m.sender_id is distinct from auth.uid()
              and m.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz)
         ) as unread,
         c.last_message_at
    from public.conversation_members cm
    join public.conversations c
      on c.id = cm.conversation_id
   where cm.profile_id = auth.uid()
     and c.tenant_id = app.current_tenant_id()
     and app.is_active_member();
$$;

revoke all on function public.messaging_unread() from anon, public;
grant execute on function public.messaging_unread() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. RLS
-- ---------------------------------------------------------------------------

alter table public.conversations        enable row level security;
alter table public.conversations        force  row level security;
alter table public.conversation_members enable row level security;
alter table public.conversation_members force  row level security;
alter table public.messages             enable row level security;
alter table public.messages             force  row level security;
alter table public.message_attachments  enable row level security;
alter table public.message_attachments  force  row level security;
alter table public.message_reactions    enable row level security;
alter table public.message_reactions    force  row level security;

-- ---- conversations --------------------------------------------------------

-- A member sees their conversation. An org admin additionally sees the
-- METADATA of every room in its tenant, because it has to be able to manage
-- rooms it is not in — a group whose last member leaves still needs deleting.
-- Direct messages are absent from that arm: see the privacy box.
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (app.is_conversation_member(id) or ((select app.is_org()) and kind <> 'direct'))
);

/*
 * Anybody in the workspace may start a conversation. An employee who has to ask
 * an administrator to open a group chat does not have a messaging product, they
 * have a ticket queue.
 *
 * A PROJECT room is the exception: it is the project's room, so it belongs to
 * whoever runs the project — the org, or the manager named on the project row
 * (059's `app.manages_project`).
 */
drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and created_by = (select auth.uid())
  and (kind <> 'project' or (select app.is_org()) or app.manages_project(project_id))
);

-- Renaming, re-colouring, archiving, changing who may post: the conversation's
-- own admins, or an org admin for a room.
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations for update to authenticated
using  (tenant_id = (select app.current_tenant_id()) and app.is_conversation_admin(id))
with check (tenant_id = (select app.current_tenant_id()) and app.is_conversation_admin(id));

-- Deleting a conversation destroys its history for everybody in it, so it is
-- the org's call or a room admin's — never an ordinary member's, who leaves
-- instead.
drop policy if exists conversations_delete on public.conversations;
create policy conversations_delete on public.conversations for delete to authenticated
using (tenant_id = (select app.current_tenant_id()) and app.is_conversation_admin(id));

-- ---- conversation_members -------------------------------------------------

-- The roster is visible to the room, and to an org admin for a room it
-- manages. Own rows are always visible, so the list query can still read the
-- caller's own `last_read_at` for a conversation they have just left.
drop policy if exists conversation_members_select on public.conversation_members;
create policy conversation_members_select on public.conversation_members for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (
    profile_id = (select auth.uid())
    or app.is_conversation_member(conversation_id)
    or app.is_conversation_admin(conversation_id)
  )
);

/*
 * Who may add somebody.
 *
 * `app.is_conversation_admin` covers the room's admins and the org, which is
 * every later "add to group". The second arm is the BOOTSTRAP, and it is
 * deliberately narrow: the creator may insert THEIR OWN row, because at that
 * instant no membership row exists and therefore nobody is an admin yet.
 *
 * It is `profile_id = auth.uid()` and not merely `created_by = auth.uid()` for
 * a reason worth stating. A creator-wide arm would outlive the creation: an
 * employee who started a group, was removed from it by an administrator, and
 * still matched `created_by` could add themselves — and anybody else — straight
 * back in, forever. Scoped to their own row it grants exactly the one insert
 * the bootstrap needs and nothing that survives it.
 *
 * The rest of an initial roster is written by `lib/messaging.ts` with the
 * service role, pinned to the caller's tenant and to profile ids proven to be
 * in it; see the box on `createConversation` for why that is narrower than
 * widening this policy would have been.
 *
 * Both arms are additionally held to the direct-message rule by
 * `tg_conversation_members_guard`.
 */
drop policy if exists conversation_members_insert on public.conversation_members;
create policy conversation_members_insert on public.conversation_members for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (
    app.is_conversation_admin(conversation_id)
    or (
      profile_id = (select auth.uid())
      and exists (
        select 1 from public.conversations c
         where c.id = conversation_id and c.created_by = (select auth.uid())
      )
    )
  )
);

-- Own row: read receipts, mute, pin. Somebody else's: only an admin, and only
-- their `role` — the guard trigger enforces which columns either may touch.
drop policy if exists conversation_members_update on public.conversation_members;
create policy conversation_members_update on public.conversation_members for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (profile_id = (select auth.uid()) or app.is_conversation_admin(conversation_id))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (profile_id = (select auth.uid()) or app.is_conversation_admin(conversation_id))
);

-- Leaving is deleting your own row; removing somebody is an admin's.
drop policy if exists conversation_members_delete on public.conversation_members;
create policy conversation_members_delete on public.conversation_members for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (profile_id = (select auth.uid()) or app.is_conversation_admin(conversation_id))
);

-- ---- messages -------------------------------------------------------------

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
using (tenant_id = (select app.current_tenant_id()) and app.can_read_conversation(conversation_id));

/*
 * `sender_id = auth.uid()` is what makes authorship unforgeable: the column is
 * set from the session on the server and checked again here, so there is no
 * path — route bug included — by which one person's message is attributed to
 * another.
 *
 * `kind <> 'system'` keeps the narration honest. "X added Y to the group" is
 * written by the server with the service role; a client that could write one
 * could fabricate any membership event it liked.
 */
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and sender_id = (select auth.uid())
  and kind <> 'system'
  and deleted_at is null
  and app.can_post_conversation(conversation_id)
);

-- Editing and retracting your own; an admin may retract anybody's (moderation)
-- and pin anybody's. The guard trigger decides WHICH columns, for both.
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and app.can_read_conversation(conversation_id)
  and (sender_id = (select auth.uid()) or app.is_conversation_admin(conversation_id))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (sender_id = (select auth.uid()) or app.is_conversation_admin(conversation_id))
);

/*
 * THERE IS NO DELETE POLICY, and that is the point.
 *
 * Retracting a message sets `deleted_at`; the row stays so replies to it still
 * resolve and the thread keeps its shape. Hard deletion happens exactly twice —
 * the conversation is deleted, or the tenant is — and both are cascades from a
 * parent the service role removed. A DELETE policy would be a second, quieter
 * way to remove history, reachable from the browser.
 */

-- ---- message_attachments --------------------------------------------------

drop policy if exists message_attachments_select on public.message_attachments;
create policy message_attachments_select on public.message_attachments for select to authenticated
using (tenant_id = (select app.current_tenant_id()) and app.can_read_conversation(conversation_id));

-- Only onto your own message, and only while you may post. An attachment row is
-- written in the same request as the message it hangs off.
drop policy if exists message_attachments_insert on public.message_attachments;
create policy message_attachments_insert on public.message_attachments for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and app.can_post_conversation(conversation_id)
  and exists (
    select 1 from public.messages m
     where m.id = message_attachments.message_id
       and m.conversation_id = message_attachments.conversation_id
       and m.sender_id = (select auth.uid())
  )
);

-- ---- message_reactions ----------------------------------------------------

drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions for select to authenticated
using (tenant_id = (select app.current_tenant_id()) and app.can_read_conversation(conversation_id));

-- You react as yourself, in a room you can post to. Reacting is not posting a
-- message, but an archived room is closed to both.
drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and app.can_post_conversation(conversation_id)
);

drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and app.can_read_conversation(conversation_id)
);

-- ---------------------------------------------------------------------------
-- 11. Privileges. 002's blanket anon revoke ran before these tables existed.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'conversations', 'conversation_members', 'messages',
    'message_attachments', 'message_reactions'
  ]
  loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 12. Realtime
--
-- The browser subscribes on the USER'S OWN session, so Postgres applies
-- `messages_select` to each subscriber: a tenant physically cannot receive
-- another tenant's events, and somebody who is not in a room cannot receive its
-- messages even though the channel name is guessable. The conversation-id
-- filter the client sends is a bandwidth optimisation, not the boundary.
--
-- `replica identity full` is required rather than optional here: the policies
-- above key off `conversation_id`, and the default (primary key only) identity
-- gives the RLS evaluator nothing to evaluate on an UPDATE or DELETE.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'conversations', 'conversation_members', 'messages',
      'message_attachments', 'message_reactions'
    ]
    loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null; end;
    end loop;
  end if;
end $$;

alter table public.conversations        replica identity full;
alter table public.conversation_members replica identity full;
alter table public.messages             replica identity full;
alter table public.message_attachments  replica identity full;
alter table public.message_reactions    replica identity full;

-- ---------------------------------------------------------------------------
-- 13. Comments
-- ---------------------------------------------------------------------------

comment on table public.conversations is
  'A direct message, a group or a project room. Readable only to its members — '
  'an org administrator sees the metadata of rooms it manages, never content.';
comment on table public.conversation_members is
  'Who is in a conversation, and what they have read. last_read_at is the whole '
  'unread model; see messaging_unread().';
comment on table public.messages is
  'What was said. Soft-deleted via deleted_at — there is deliberately no DELETE policy.';
comment on table public.message_attachments is
  'An image, file or voice note on a message. storage_key is an R2 key, never a URL.';
comment on table public.message_reactions is
  'One emoji, one person, one message. The primary key IS the uniqueness rule.';
