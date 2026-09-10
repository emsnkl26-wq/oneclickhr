-- ============================================================================
-- 030_task_management.sql — the Kanban board grows into a real task manager.
--
-- WHAT 001 GAVE US. `boards` / `board_columns` / `tasks` / `task_assignees`:
-- a card with a title, a priority, a due date and a column. Enough to draw
-- three columns; not enough to run work through. There was nowhere to discuss a
-- task, nowhere to break it down, nowhere to record why it moved, and a
-- "status" that was only ever implied by which column a card happened to sit in.
--
-- WHAT THIS ADDS, and why each one is a TABLE rather than a column:
--
--   task_status (enum)   A stage and a state are different things. A column is
--                        how a team CHOOSES to lay work out ("Design", "QA",
--                        "Waiting on client"); the status is what the card
--                        actually IS, in vocabulary the product understands.
--                        Reporting, notifications and the employee's "what is
--                        on me" view all need the second one, and none of them
--                        should have to parse a column name to get it. A column
--                        may DECLARE a status it applies on entry
--                        (`board_columns.applies_status`), which is how a drag
--                        into "Done" also completes the task.
--
--   task_comments        Threaded, one level deep: a comment, and replies to
--                        that comment. Deliberately not arbitrary nesting —
--                        every product that allowed it now renders it flattened
--                        anyway, and a `parent_id` that can chain makes
--                        "delete a comment" a recursive problem for no gain.
--                        Soft-deleted (`deleted_at`), because removing a row
--                        from the middle of a discussion silently rewrites what
--                        the rest of the thread appears to be replying to.
--
--   task_checklist_items Subtasks that never need their own card. A checklist
--                        item has no assignee and no due date on purpose; the
--                        moment it wants one it should be a task.
--
--   task_labels /        Cross-cutting classification the column axis cannot
--   task_label_links     express. Scoped to a BOARD, not a tenant, so one
--                        team's "Blocked" does not appear in another's picker.
--
--   task_watchers        Who hears about this. Assignment implies watching;
--                        commenting implies watching (see the triggers). A
--                        watcher list people maintain by hand is a watcher list
--                        nobody maintains.
--
--   task_activity        The card's history: moved, reassigned, re-prioritised,
--                        completed. Written by TRIGGERS, not by the API layer —
--                        so it records what happened to the row no matter which
--                        path wrote it, and cannot be forgotten by the next
--                        route somebody adds.
--
-- THE PERMISSION MODEL, restated because this migration widens it:
--
--   Before: only an org user could create a task. That made the board a thing
--   done TO employees. A task manager in which the people doing the work cannot
--   write down the work is not one.
--
--   After:
--     create  — any active member, as themselves.
--     update  — org: any card. employee: cards they are assigned to OR created.
--     delete  — org: any card. employee: only cards they created AND that
--               nobody else has been assigned to (so deleting cannot be used to
--               make someone else's work disappear).
--     comment — any active member, as themselves. Edit your own only.
--
--   Every one of those is a POLICY. The routes do not re-implement them; they
--   let a refused write return zero rows and report that as a 403, so the rule
--   has exactly one definition.
--
-- TENANT SAFETY. Every new child table carries `tenant_id` and is bound to its
-- parent by a COMPOSITE foreign key `(parent_id, tenant_id)`, exactly as 018
-- established. A single-column key only asks whether the parent EXISTS, never
-- whose it is — which is how a row in tenant A ends up hanging off tenant B's
-- task. The composite key binds every writer, including the service role.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.task_status as enum
    ('todo', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_activity_kind as enum
    ('created', 'moved', 'status_changed', 'priority_changed', 'assigned',
     'unassigned', 'due_date_changed', 'renamed', 'commented', 'completed',
     'reopened', 'archived', 'restored');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. boards — a per-board counter for human-readable task references.
--
-- "#14" in a standup is worth more than the first eight characters of a uuid.
-- The counter lives on the BOARD row and is incremented inside the insert
-- trigger, so the row lock Postgres already takes to update it serialises
-- concurrent inserts for free — no sequence to get out of step with a restore,
-- no max()+1 race.
-- ---------------------------------------------------------------------------

alter table public.boards
  add column if not exists task_seq    bigint not null default 0,
  add column if not exists description text,
  add column if not exists updated_at  timestamptz not null default now();

do $$ begin
  alter table public.boards add constraint boards_description_len_chk
    check (description is null or length(description) <= 500);
exception when duplicate_object then null; end $$;

drop trigger if exists set_updated_at on public.boards;
create trigger set_updated_at before update on public.boards
  for each row execute function public.tg_set_updated_at();

-- Needed as the target of every composite (id, tenant_id) key below. Redundant
-- on its own — `id` is already the primary key — but a foreign key can only
-- reference a UNIQUE set of columns.
do $$ begin
  alter table public.boards add constraint boards_id_tenant_uniq unique (id, tenant_id);
exception when duplicate_table or duplicate_object then null; end $$;

do $$ begin
  alter table public.board_columns add constraint board_columns_id_tenant_uniq unique (id, tenant_id);
exception when duplicate_table or duplicate_object then null; end $$;

do $$ begin
  alter table public.tasks add constraint tasks_id_tenant_uniq unique (id, tenant_id);
exception when duplicate_table or duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. board_columns — a stage, not just a heading.
--
--   color           the swatch on the column and on every chip that names it.
--   wip_limit       a soft ceiling. NOT enforced by a constraint: a work-in-
--                   progress limit is a conversation a team has with itself,
--                   and a database that hard-refuses the drop just teaches
--                   people to make a card they cannot file. The UI warns.
--   applies_status  drag a card here and it becomes this status. NULL means the
--                   column expresses no opinion.
--   is_backlog      where a newly created task lands when nobody picked.
-- ---------------------------------------------------------------------------

alter table public.board_columns
  add column if not exists color          text,
  add column if not exists wip_limit      integer,
  add column if not exists applies_status public.task_status,
  add column if not exists is_backlog     boolean not null default false;

do $$ begin
  alter table public.board_columns add constraint board_columns_color_chk
    check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.board_columns add constraint board_columns_wip_chk
    check (wip_limit is null or (wip_limit between 1 and 999));
exception when duplicate_object then null; end $$;

-- Fractional positions on columns too, so reordering a column writes ONE row
-- for the same reason a card drag does. The existing integer column is widened
-- rather than replaced, so no data moves.
alter table public.board_columns
  alter column position type numeric(20,6) using position::numeric;

-- ---------------------------------------------------------------------------
-- 3. tasks — the fields a card needs to be more than a sticky note.
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists status         public.task_status not null default 'todo',
  add column if not exists reference      integer,
  add column if not exists start_date     date,
  add column if not exists estimate_hours numeric(8,2),
  add column if not exists completed_at   timestamptz,
  add column if not exists archived_at    timestamptz,
  add column if not exists comment_count  integer not null default 0,
  add column if not exists updated_by     uuid references public.profiles(id) on delete set null;

do $$ begin
  alter table public.tasks add constraint tasks_estimate_chk
    check (estimate_hours is null or (estimate_hours >= 0 and estimate_hours <= 10000));
exception when duplicate_object then null; end $$;

-- A start date after the due date is a data-entry slip, not a plan.
do $$ begin
  alter table public.tasks add constraint tasks_date_order_chk
    check (start_date is null or due_date is null or start_date <= due_date);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tasks add constraint tasks_description_len_chk
    check (description is null or length(description) <= 20000);
exception when duplicate_object then null; end $$;

create unique index if not exists tasks_board_reference_uidx
  on public.tasks (board_id, reference) where reference is not null;

-- The board's own query: one column, in order, excluding archived cards.
create index if not exists tasks_board_open_idx
  on public.tasks (board_id, column_id, position) where archived_at is null;

-- "What is on me" — the single most-run task query in the product.
create index if not exists tasks_tenant_status_idx
  on public.tasks (tenant_id, status, due_date);

-- ---------------------------------------------------------------------------
-- 4. A tenant-safe key 018 missed.
--
-- 018 added composite keys for (board_id, tenant_id) and (column_id, tenant_id)
-- on tasks. `task_assignees` never got one: `task_id -> tasks(id)` alone lets a
-- row claiming tenant A point at tenant B's task. Same hole, same fix.
-- ---------------------------------------------------------------------------

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
    from public.task_assignees ta
    join public.tasks t on t.id = ta.task_id
   where ta.tenant_id is distinct from t.tenant_id;

  if v_bad > 0 then
    raise exception
      'task_assignees has % row(s) pointing at another tenant''s task. Resolve these before running 030.', v_bad;
  end if;
end $$;

do $$ begin
  alter table public.task_assignees drop constraint if exists task_assignees_task_id_fkey;
  alter table public.task_assignees
    add constraint task_assignees_task_tenant_fkey
    foreign key (task_id, tenant_id) references public.tasks (id, tenant_id) on delete cascade;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 5. task_labels / task_label_links
-- ---------------------------------------------------------------------------

create table if not exists public.task_labels (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  board_id   uuid not null,
  name       text not null check (length(btrim(name)) between 1 and 40),
  color      text not null default '#64748B' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  foreign key (board_id, tenant_id) references public.boards (id, tenant_id) on delete cascade
);

do $$ begin
  alter table public.task_labels add constraint task_labels_id_tenant_uniq unique (id, tenant_id);
exception when duplicate_table or duplicate_object then null; end $$;

-- Case-insensitive: "Urgent" and "urgent" on one board are the same label, and
-- a picker showing both is a picker nobody trusts.
create unique index if not exists task_labels_board_name_uidx
  on public.task_labels (board_id, lower(btrim(name)));

create index if not exists task_labels_tenant_idx on public.task_labels (tenant_id);

create table if not exists public.task_label_links (
  task_id    uuid not null,
  label_id   uuid not null,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, label_id),
  foreign key (task_id, tenant_id)  references public.tasks (id, tenant_id) on delete cascade,
  foreign key (label_id, tenant_id) references public.task_labels (id, tenant_id) on delete cascade
);

create index if not exists task_label_links_label_idx  on public.task_label_links (label_id);
create index if not exists task_label_links_tenant_idx on public.task_label_links (tenant_id);

-- ---------------------------------------------------------------------------
-- 6. task_comments — the discussion.
--
-- `parent_id` is one level deep and the trigger below is what keeps it that
-- way: a reply's parent must itself be a root comment. Enforced by trigger
-- rather than by a check constraint because it is a statement about ANOTHER
-- row, which a check cannot see.
--
-- `author_name` is a snapshot. A thread has to still read correctly two years
-- later when the person who wrote it has left and the profile join comes back
-- empty — the same reason `ticket_messages` denormalises `author_role`.
-- ---------------------------------------------------------------------------

create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  task_id     uuid not null,
  parent_id   uuid references public.task_comments(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text check (author_name is null or length(author_name) <= 160),
  author_role public.user_role not null default 'employee',
  body        text not null check (length(btrim(body)) between 1 and 8000),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id) on delete cascade
);

create index if not exists task_comments_task_idx   on public.task_comments (task_id, created_at);
create index if not exists task_comments_parent_idx on public.task_comments (parent_id, created_at);
create index if not exists task_comments_tenant_idx on public.task_comments (tenant_id);

/**
 * Replies attach to root comments only, and never across tasks.
 *
 * Without the first rule `parent_id` chains, and a thread becomes a tree the UI
 * flattens anyway while `on delete cascade` quietly removes grandchildren
 * nobody was looking at. Without the second, a reply could be filed under a
 * comment on a different card.
 */
create or replace function public.tg_task_comment_parent_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent public.task_comments%rowtype;
begin
  if new.parent_id is null then
    return new;
  end if;

  select * into v_parent from public.task_comments where id = new.parent_id;

  if not found then
    raise exception 'That comment no longer exists.' using errcode = '23503';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'Replies attach to a comment, not to another reply.' using errcode = '23514';
  end if;
  if v_parent.task_id <> new.task_id or v_parent.tenant_id <> new.tenant_id then
    raise exception 'That comment belongs to a different task.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists task_comment_parent_check on public.task_comments;
create trigger task_comment_parent_check
  before insert or update of parent_id, task_id on public.task_comments
  for each row execute function public.tg_task_comment_parent_check();

-- ---------------------------------------------------------------------------
-- 7. task_checklist_items
-- ---------------------------------------------------------------------------

create table if not exists public.task_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  task_id    uuid not null,
  content    text not null check (length(btrim(content)) between 1 and 300),
  is_done    boolean not null default false,
  position   numeric(20,6) not null default 1000,
  done_at    timestamptz,
  done_by    uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id) on delete cascade
);

create index if not exists task_checklist_task_idx   on public.task_checklist_items (task_id, position);
create index if not exists task_checklist_tenant_idx on public.task_checklist_items (tenant_id);

-- `done_at` is derived from `is_done`, so it is set here rather than trusted
-- from the request — a client that forgot to send it, or sent a date of its own
-- choosing, cannot desynchronise the two.
create or replace function public.tg_checklist_done_stamp()
returns trigger
language plpgsql
set search_path = public, auth, pg_temp
as $$
begin
  if new.is_done and (tg_op = 'INSERT' or not old.is_done) then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif not new.is_done then
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists checklist_done_stamp on public.task_checklist_items;
create trigger checklist_done_stamp before insert or update on public.task_checklist_items
  for each row execute function public.tg_checklist_done_stamp();

-- ---------------------------------------------------------------------------
-- 8. task_watchers
-- ---------------------------------------------------------------------------

create table if not exists public.task_watchers (
  task_id    uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, profile_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id) on delete cascade
);

create index if not exists task_watchers_profile_idx on public.task_watchers (profile_id);
create index if not exists task_watchers_tenant_idx  on public.task_watchers (tenant_id);

-- ---------------------------------------------------------------------------
-- 9. task_activity — the card's history.
--
-- Append-only: no update policy and no delete policy anywhere below. A history
-- somebody can quietly edit is not a history.
-- ---------------------------------------------------------------------------

create table if not exists public.task_activity (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  task_id    uuid not null,
  actor_id   uuid references public.profiles(id) on delete set null,
  actor_name text check (actor_name is null or length(actor_name) <= 160),
  kind       public.task_activity_kind not null,
  -- Small and self-describing: {"from":"todo","to":"done"}. Never a whole row —
  -- this table is read by everyone in the tenant who can see the card.
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id) on delete cascade
);

create index if not exists task_activity_task_idx   on public.task_activity (task_id, created_at desc);
create index if not exists task_activity_tenant_idx on public.task_activity (tenant_id);

/** The display name of whoever is making the current request, snapshotted. */
create or replace function app.actor_name()
returns text
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(p.full_name, p.email)
    from public.profiles p
   where p.id = auth.uid();
$$;

create or replace function public.log_task_activity(
  p_task_id uuid,
  p_tenant_id uuid,
  p_kind public.task_activity_kind,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.task_activity (tenant_id, task_id, actor_id, actor_name, kind, meta)
  values (p_tenant_id, p_task_id, auth.uid(), app.actor_name(), p_kind, coalesce(p_meta, '{}'::jsonb));
exception when others then
  -- History is a courtesy attached to an operation that has already been
  -- decided. Losing a log line must never roll back the move it describes.
  raise warning '[task_activity] % on task %: %', p_kind, p_task_id, sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Triggers that keep derived state honest.
--
-- All of these live in the DATABASE rather than in the route handlers, because
-- there is more than one writer (two API surfaces today, cron and any admin
-- script tomorrow) and a rule enforced in one of them is not a rule.
-- ---------------------------------------------------------------------------

/**
 * Stamp a new task: its board reference, and the status implied by the column
 * it was filed into.
 */
create or replace function public.tg_task_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_applies public.task_status;
begin
  if new.reference is null then
    update public.boards
       set task_seq = task_seq + 1
     where id = new.board_id
    returning task_seq into new.reference;
  end if;

  select applies_status into v_applies
    from public.board_columns where id = new.column_id;

  -- An explicit status on the insert wins; the column only fills a blank.
  if v_applies is not null and new.status = 'todo' then
    new.status := v_applies;
  end if;

  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists task_before_insert on public.tasks;
create trigger task_before_insert before insert on public.tasks
  for each row execute function public.tg_task_before_insert();

/**
 * Moving a card into a column that declares a status applies that status, and
 * reaching (or leaving) `done` maintains `completed_at`.
 *
 * The guard on the first rule matters: it fires only when the COLUMN changed
 * and the caller did not say otherwise. Without it, setting a card's status to
 * something its column disagrees with would be undone by the next unrelated
 * save.
 */
create or replace function public.tg_task_before_update()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_applies public.task_status;
begin
  if new.column_id is distinct from old.column_id and new.status = old.status then
    select applies_status into v_applies
      from public.board_columns where id = new.column_id;
    if v_applies is not null then
      new.status := v_applies;
    end if;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' and old.status = 'done' then
    new.completed_at := null;
  end if;

  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end;
$$;

drop trigger if exists task_before_update on public.tasks;
create trigger task_before_update before update on public.tasks
  for each row execute function public.tg_task_before_update();

/** Everything that happened to the card, recorded once, after the fact. */
create or replace function public.tg_task_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_task_activity(new.id, new.tenant_id, 'created',
      jsonb_build_object('title', new.title));

    -- The creator watches their own card unless somebody removes them.
    if auth.uid() is not null then
      insert into public.task_watchers (task_id, profile_id, tenant_id)
      values (new.id, auth.uid(), new.tenant_id)
      on conflict do nothing;
    end if;
    return null;
  end if;

  if new.column_id is distinct from old.column_id then
    perform public.log_task_activity(new.id, new.tenant_id, 'moved',
      jsonb_build_object('from', old.column_id, 'to', new.column_id));
  end if;

  if new.status is distinct from old.status then
    perform public.log_task_activity(
      new.id, new.tenant_id,
      case
        when new.status = 'done' then 'completed'::public.task_activity_kind
        when old.status = 'done' then 'reopened'::public.task_activity_kind
        else 'status_changed'::public.task_activity_kind
      end,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.priority is distinct from old.priority then
    perform public.log_task_activity(new.id, new.tenant_id, 'priority_changed',
      jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;

  if new.due_date is distinct from old.due_date then
    perform public.log_task_activity(new.id, new.tenant_id, 'due_date_changed',
      jsonb_build_object('from', old.due_date, 'to', new.due_date));
  end if;

  if new.title is distinct from old.title then
    perform public.log_task_activity(new.id, new.tenant_id, 'renamed',
      jsonb_build_object('from', old.title, 'to', new.title));
  end if;

  if new.archived_at is distinct from old.archived_at then
    perform public.log_task_activity(new.id, new.tenant_id,
      case when new.archived_at is null then 'restored'::public.task_activity_kind
           else 'archived'::public.task_activity_kind end, '{}'::jsonb);
  end if;

  return null;
end;
$$;

drop trigger if exists task_after_write on public.tasks;
create trigger task_after_write after insert or update on public.tasks
  for each row execute function public.tg_task_after_write();

/** Assignment: log it, and make the assignee a watcher. */
create or replace function public.tg_task_assignee_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_row public.task_assignees%rowtype := coalesce(new, old);
  v_name text;
begin
  select coalesce(full_name, email) into v_name
    from public.profiles where id = v_row.profile_id;

  if tg_op = 'INSERT' then
    perform public.log_task_activity(v_row.task_id, v_row.tenant_id, 'assigned',
      jsonb_build_object('profile_id', v_row.profile_id, 'name', v_name));

    insert into public.task_watchers (task_id, profile_id, tenant_id)
    values (v_row.task_id, v_row.profile_id, v_row.tenant_id)
    on conflict do nothing;
  else
    perform public.log_task_activity(v_row.task_id, v_row.tenant_id, 'unassigned',
      jsonb_build_object('profile_id', v_row.profile_id, 'name', v_name));
  end if;

  return null;
end;
$$;

drop trigger if exists task_assignee_after_write on public.task_assignees;
create trigger task_assignee_after_write after insert or delete on public.task_assignees
  for each row execute function public.tg_task_assignee_after_write();

/**
 * A comment bumps the card, counts itself, logs itself, and subscribes its
 * author.
 *
 * `comment_count` is maintained here rather than counted on read: the board
 * shows a comment badge on every visible card, and a count(*) per card is the
 * kind of query that is free with ten cards and a problem with two thousand.
 * A soft delete decrements it, so the badge matches what the thread renders.
 */
create or replace function public.tg_task_comment_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.tasks
       set comment_count = comment_count + 1, updated_at = now()
     where id = new.task_id;

    perform public.log_task_activity(new.task_id, new.tenant_id, 'commented',
      jsonb_build_object('comment_id', new.id, 'reply', new.parent_id is not null));

    if new.author_id is not null then
      insert into public.task_watchers (task_id, profile_id, tenant_id)
      values (new.task_id, new.author_id, new.tenant_id)
      on conflict do nothing;
    end if;

  elsif tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then
    update public.tasks
       set comment_count = greatest(comment_count - 1, 0)
     where id = new.task_id;

  elsif tg_op = 'DELETE' and old.deleted_at is null then
    update public.tasks
       set comment_count = greatest(comment_count - 1, 0)
     where id = old.task_id;
  end if;

  return null;
end;
$$;

drop trigger if exists task_comment_after_write on public.task_comments;
create trigger task_comment_after_write after insert or update or delete on public.task_comments
  for each row execute function public.tg_task_comment_after_write();

-- ---------------------------------------------------------------------------
-- 11. app helpers for the policies below.
-- ---------------------------------------------------------------------------

/** Did the caller create this task? */
create or replace function app.created_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task_id and t.created_by = auth.uid()
  );
$$;

/**
 * May the caller work on this card at all — comment on it, watch it?
 *
 * Everyone who can SEE a card in their own tenant can discuss it. A task board
 * on which only the assignee may say anything produces the conversations that
 * end up in a chat app instead, which is where task context goes to die.
 */
create or replace function app.can_touch_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select app.is_active_member() and exists (
    select 1 from public.tasks t
     where t.id = p_task_id and t.tenant_id = app.current_tenant_id()
  );
$$;

/** Nobody but the caller is on the hook for this card yet. */
create or replace function app.task_is_unassigned(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select not exists (
    select 1 from public.task_assignees ta
     where ta.task_id = p_task_id and ta.profile_id <> auth.uid()
  );
$$;

revoke all on all functions in schema app from anon, public;
grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. RLS
-- ---------------------------------------------------------------------------

alter table public.task_labels          enable row level security;
alter table public.task_label_links     enable row level security;
alter table public.task_comments        enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_watchers        enable row level security;
alter table public.task_activity        enable row level security;

alter table public.task_labels          force row level security;
alter table public.task_label_links     force row level security;
alter table public.task_comments        force row level security;
alter table public.task_checklist_items force row level security;
alter table public.task_watchers        force row level security;
alter table public.task_activity        force row level security;

-- ---- tasks: the widened create/update/delete rules ------------------------
--
-- SELECT is unchanged from 002 and is deliberately not restated here.

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  -- An employee files a task as THEMSELVES. Without this an employee could
  -- create a card attributed to their manager, which the delete rule below
  -- would then read as "the manager's to remove".
  and ((select app.is_org()) or created_by = (select auth.uid()))
);

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or app.is_task_assignee(id) or app.created_task(id))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and ((select app.is_org()) or app.is_task_assignee(id) or app.created_task(id))
);

-- An employee may withdraw a card they raised, but only while it is still only
-- theirs. Once somebody else is assigned, deleting it would remove another
-- person's work — that is an org decision.
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or (app.created_task(id) and app.task_is_unassigned(id)))
);

-- ---- task_assignees: an employee may pick up a card they raised -----------

drop policy if exists task_assignees_write on public.task_assignees;

drop policy if exists task_assignees_insert on public.task_assignees;
create policy task_assignees_insert on public.task_assignees for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  -- Assigning OTHER people is an org act. An employee may only add themselves,
  -- and only to a card they raised — self-assignment, not conscription.
  and ((select app.is_org()) or (profile_id = (select auth.uid()) and app.created_task(task_id)))
);

drop policy if exists task_assignees_delete on public.task_assignees;
create policy task_assignees_delete on public.task_assignees for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or profile_id = (select auth.uid()))
);

-- ---- task_labels ----------------------------------------------------------

drop policy if exists task_labels_select on public.task_labels;
create policy task_labels_select on public.task_labels for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_active_member()))
);

-- The label VOCABULARY is the org's; applying one is not (see the links table).
drop policy if exists task_labels_write on public.task_labels;
create policy task_labels_write on public.task_labels for all to authenticated
using  (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

drop policy if exists task_label_links_select on public.task_label_links;
create policy task_label_links_select on public.task_label_links for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_active_member()))
);

drop policy if exists task_label_links_insert on public.task_label_links;
create policy task_label_links_insert on public.task_label_links for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or app.is_task_assignee(task_id) or app.created_task(task_id))
);

drop policy if exists task_label_links_delete on public.task_label_links;
create policy task_label_links_delete on public.task_label_links for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or app.is_task_assignee(task_id) or app.created_task(task_id))
);

-- ---- task_comments --------------------------------------------------------

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_active_member()))
);

-- As yourself, on a card in your own tenant. `author_id` is pinned to the
-- session so a comment cannot be posted in somebody else's name.
drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and deleted_at is null
  and app.can_touch_task(task_id)
);

-- Editing is the AUTHOR'S alone, org included. An admin who can rewrite what
-- somebody else said turns the thread into something nobody can rely on having
-- read. Removal is a different question — see the delete policy.
drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and author_id = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
);

-- Removal: the author, or the org moderating its own workspace. The app
-- soft-deletes (an UPDATE setting `deleted_at`, which the author's own policy
-- above covers); this is the org's ability to actually remove something, and
-- the only reason the org appears in a comment write rule at all.
drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (author_id = (select auth.uid()) or (select app.is_org()))
);

-- ---- task_checklist_items -------------------------------------------------

drop policy if exists task_checklist_select on public.task_checklist_items;
create policy task_checklist_select on public.task_checklist_items for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_active_member()))
);

drop policy if exists task_checklist_write on public.task_checklist_items;
create policy task_checklist_write on public.task_checklist_items for all to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or app.is_task_assignee(task_id) or app.created_task(task_id))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or app.is_task_assignee(task_id) or app.created_task(task_id))
);

-- ---- task_watchers --------------------------------------------------------

drop policy if exists task_watchers_select on public.task_watchers;
create policy task_watchers_select on public.task_watchers for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_active_member()))
);

drop policy if exists task_watchers_insert on public.task_watchers;
create policy task_watchers_insert on public.task_watchers for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and ((select app.is_org()) or (profile_id = (select auth.uid()) and app.can_touch_task(task_id)))
);

drop policy if exists task_watchers_delete on public.task_watchers;
create policy task_watchers_delete on public.task_watchers for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.is_org()) or profile_id = (select auth.uid()))
);

-- ---- task_activity — readable, never writable from a session --------------
--
-- The only writer is `log_task_activity()`, which is SECURITY DEFINER and
-- therefore bypasses this. No insert/update/delete policy exists, so a session
-- cannot forge or erase a history entry even as an org owner.

drop policy if exists task_activity_select on public.task_activity;
create policy task_activity_select on public.task_activity for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_active_member()))
);

-- ---------------------------------------------------------------------------
-- 13. Realtime.
--
-- Subscribers run on their OWN session, so Supabase applies the SELECT policies
-- above per subscriber — a tenant physically cannot receive another tenant's
-- events. `replica identity full` is what lets it evaluate those policies
-- against the OLD row on UPDATE and DELETE.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.task_comments';        exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.task_checklist_items'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.task_label_links';     exception when duplicate_object then null; end;
  end if;
end $$;

alter table public.task_comments        replica identity full;
alter table public.task_checklist_items replica identity full;
alter table public.task_label_links     replica identity full;
alter table public.task_assignees       replica identity full;

-- ---------------------------------------------------------------------------
-- 14. Backfill.
--
-- Existing boards have columns but no stage metadata, and existing tasks have
-- no reference number and no status. Both are filled in from what is already
-- there, so an upgraded workspace opens looking finished rather than blank.
-- ---------------------------------------------------------------------------

-- The first column of each board becomes its backlog, unless one is already
-- marked. `distinct on` picks the lowest position per board.
with firsts as (
  select distinct on (board_id) id, board_id
    from public.board_columns
   order by board_id, position, created_at
)
update public.board_columns c
   set is_backlog = true
  from firsts f
 where c.id = f.id
   and not exists (
     select 1 from public.board_columns o
      where o.board_id = c.board_id and o.is_backlog
   );

-- Name-based inference, applied once and only where the column has no opinion
-- yet. Crude, and correct for the three columns every seeded board has.
--
-- Every branch is cast explicitly. A bare 'done' is an untyped literal, and the
-- `else null` gives Postgres nothing to resolve the CASE against, so the whole
-- expression settles on `text` and the assignment to a `task_status` column is
-- refused. Casting one branch would be enough for the resolver; casting all of
-- them is enough for the next person reading it.
update public.board_columns
   set applies_status = case
         when lower(btrim(name)) in ('done', 'complete', 'completed', 'shipped', 'closed') then 'done'::public.task_status
         when lower(btrim(name)) in ('in progress', 'in-progress', 'doing', 'active', 'wip') then 'in_progress'::public.task_status
         when lower(btrim(name)) in ('in review', 'review', 'qa', 'testing')                 then 'in_review'::public.task_status
         when lower(btrim(name)) in ('blocked', 'on hold', 'waiting', 'stuck')               then 'blocked'::public.task_status
         else null::public.task_status
       end
 where applies_status is null;

update public.board_columns
   set color = case
         when applies_status = 'done'        then '#16A34A'
         when applies_status = 'in_progress' then '#2563EB'
         when applies_status = 'in_review'   then '#9333EA'
         when applies_status = 'blocked'     then '#DC2626'
         else '#64748B'
       end
 where color is null;

-- Existing cards inherit the status their column implies.
update public.tasks t
   set status = c.applies_status
  from public.board_columns c
 where c.id = t.column_id
   and c.applies_status is not null
   and t.status = 'todo';

update public.tasks
   set completed_at = coalesce(completed_at, updated_at)
 where status = 'done' and completed_at is null;

-- Reference numbers, oldest card first, and the board counter left pointing
-- past the highest one issued.
with numbered as (
  select id, row_number() over (partition by board_id order by created_at, id) as n
    from public.tasks
   where reference is null
)
update public.tasks t
   set reference = n.n
  from numbered n
 where t.id = n.id;

update public.boards b
   set task_seq = greatest(b.task_seq, coalesce(m.max_ref, 0))
  from (select board_id, max(reference) as max_ref from public.tasks group by board_id) m
 where m.board_id = b.id;

-- Assignees and creators become watchers of what they already own.
insert into public.task_watchers (task_id, profile_id, tenant_id)
select ta.task_id, ta.profile_id, ta.tenant_id from public.task_assignees ta
on conflict do nothing;

insert into public.task_watchers (task_id, profile_id, tenant_id)
select t.id, t.created_by, t.tenant_id from public.tasks t where t.created_by is not null
on conflict do nothing;
