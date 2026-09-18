-- ============================================================================
-- 038_task_boards.sql — many boards per tenant, each with its own members.
--
-- WHAT CHANGES. Until now a tenant had exactly one `boards` row (created at
-- provisioning) and everybody in the tenant saw every card on it. Now:
--
--   * A tenant has any number of boards. A board carries a name, an optional
--     description and a colour that themes its card and its page header.
--   * `board_members` says who is on a board. The org sees every board in its
--     tenant; an EMPLOYEE sees only boards they are a member of — enforced by
--     the SELECT policies below, not by the UI.
--   * Tasks stay visible to their assignees and their creator regardless, per
--     the existing rules. Assigning someone to a card also makes them a member
--     of its board (trigger), so "assigned but cannot open the board" does not
--     happen.
--
-- WHY `boards` IS EXTENDED RATHER THAN A NEW `task_boards` TABLE. `boards`
-- already IS the task board: `board_columns.board_id`, `tasks.board_id`,
-- `task_labels.board_id` and the per-board reference counter all hang off it,
-- with composite (id, tenant_id) keys since 018/030. A parallel table would
-- mean a second foreign key on every one of those and a data move for nothing.
--
-- BACKFILL. Every existing board (the provisioned "Team Board", which is the
-- tenant's "General" board) keeps its columns and cards untouched. Everyone
-- already assigned to, or who raised, a card on it becomes a member. Runs once
-- (see the marker on the table comment) so re-running the file cannot re-add
-- somebody the org has since removed.
--
-- ALSO FIXES: the assignee trigger's side effects (history, watcher, now board
-- membership) are each isolated, so a failure in a courtesy write can never
-- roll back the assignment it describes.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. boards — colour
-- ---------------------------------------------------------------------------

alter table public.boards
  add column if not exists color text not null default '#2563EB';

do $$ begin
  alter table public.boards add constraint boards_color_chk
    check (color ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. board_members
--
-- Both keys are composite, so a membership row can bind neither another
-- tenant's board nor another tenant's person — for every writer, service role
-- included.
-- ---------------------------------------------------------------------------

create table if not exists public.board_members (
  board_id   uuid not null,
  profile_id uuid not null,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  added_by   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (board_id, profile_id),
  foreign key (board_id, tenant_id)   references public.boards (id, tenant_id)   on delete cascade,
  foreign key (profile_id, tenant_id) references public.profiles (id, tenant_id) on delete cascade
);

create index if not exists board_members_profile_idx on public.board_members (profile_id);
create index if not exists board_members_tenant_idx  on public.board_members (tenant_id);

-- ---------------------------------------------------------------------------
-- 3. app helpers
-- ---------------------------------------------------------------------------

/** Is the caller a member of this board? */
create or replace function app.is_board_member(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.board_members bm
     where bm.board_id = p_board_id and bm.profile_id = auth.uid()
  );
$$;

/**
 * May the caller SEE this card? Org: anything in its tenant. Employee: cards on
 * a board they belong to, plus cards assigned to them or raised by them.
 */
create or replace function app.can_see_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select app.is_active_member() and exists (
    select 1 from public.tasks t
     where t.id = p_task_id
       and t.tenant_id = app.current_tenant_id()
       and (
         app.is_org()
         or app.is_board_member(t.board_id)
         or t.created_by = auth.uid()
         or exists (select 1 from public.task_assignees ta
                     where ta.task_id = t.id and ta.profile_id = auth.uid())
       )
  );
$$;

-- 030's "may discuss / watch this card" now follows visibility: you cannot
-- comment on a card on a board you cannot see.
create or replace function app.can_touch_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select app.can_see_task(p_task_id);
$$;

revoke all on all functions in schema app from anon, public;
grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Assignment implies membership. Side effects isolated.
-- ---------------------------------------------------------------------------

create or replace function public.tg_task_assignee_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_row   public.task_assignees%rowtype;
  v_name  text;
  v_board uuid;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;

  select coalesce(full_name, email) into v_name
    from public.profiles where id = v_row.profile_id;

  if tg_op = 'INSERT' then
    perform public.log_task_activity(v_row.task_id, v_row.tenant_id, 'assigned',
      jsonb_build_object('profile_id', v_row.profile_id, 'name', v_name));

    -- Each courtesy write in its own block: losing one must never undo the
    -- assignment itself.
    begin
      insert into public.task_watchers (task_id, profile_id, tenant_id)
      values (v_row.task_id, v_row.profile_id, v_row.tenant_id)
      on conflict do nothing;
    exception when others then
      raise warning '[task_assignees] watcher for % on %: %', v_row.profile_id, v_row.task_id, sqlerrm;
    end;

    begin
      select board_id into v_board from public.tasks where id = v_row.task_id;
      if v_board is not null then
        insert into public.board_members (board_id, profile_id, tenant_id, added_by)
        values (v_board, v_row.profile_id, v_row.tenant_id, auth.uid())
        on conflict do nothing;
      end if;
    exception when others then
      raise warning '[task_assignees] board membership for % on %: %', v_row.profile_id, v_row.task_id, sqlerrm;
    end;
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

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------

alter table public.board_members enable row level security;
alter table public.board_members force row level security;

-- ---- board_members --------------------------------------------------------

-- The org sees every roster; an employee sees their own row and the roster of
-- any board they are on (so the board page can show who else is there).
drop policy if exists board_members_select on public.board_members;
create policy board_members_select on public.board_members for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or profile_id = (select auth.uid()) or app.is_board_member(board_id))
  )
);

drop policy if exists board_members_write on public.board_members;
create policy board_members_write on public.board_members for all to authenticated
using  (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

-- ---- boards / columns / labels: membership-scoped reads -------------------

drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or app.is_board_member(id))
  )
);

drop policy if exists board_columns_select on public.board_columns;
create policy board_columns_select on public.board_columns for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or app.is_board_member(board_id))
  )
);

drop policy if exists task_labels_select on public.task_labels;
create policy task_labels_select on public.task_labels for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or app.is_board_member(board_id))
  )
);

-- ---- tasks ----------------------------------------------------------------

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and (
      (select app.is_org())
      or app.is_board_member(board_id)
      or created_by = (select auth.uid())
      or app.is_task_assignee(id)
    )
  )
);

-- As 030, plus: an employee files cards only onto a board they belong to.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (
    (select app.is_org())
    or (created_by = (select auth.uid()) and app.is_board_member(board_id))
  )
);

-- ---- per-card children follow the card's visibility -----------------------

drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select on public.task_assignees for select to authenticated
using ((select app.is_super_admin()) or (tenant_id = (select app.current_tenant_id()) and app.can_see_task(task_id)));

drop policy if exists task_label_links_select on public.task_label_links;
create policy task_label_links_select on public.task_label_links for select to authenticated
using ((select app.is_super_admin()) or (tenant_id = (select app.current_tenant_id()) and app.can_see_task(task_id)));

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select to authenticated
using ((select app.is_super_admin()) or (tenant_id = (select app.current_tenant_id()) and app.can_see_task(task_id)));

drop policy if exists task_checklist_select on public.task_checklist_items;
create policy task_checklist_select on public.task_checklist_items for select to authenticated
using ((select app.is_super_admin()) or (tenant_id = (select app.current_tenant_id()) and app.can_see_task(task_id)));

drop policy if exists task_watchers_select on public.task_watchers;
create policy task_watchers_select on public.task_watchers for select to authenticated
using ((select app.is_super_admin()) or (tenant_id = (select app.current_tenant_id()) and app.can_see_task(task_id)));

drop policy if exists task_activity_select on public.task_activity;
create policy task_activity_select on public.task_activity for select to authenticated
using ((select app.is_super_admin()) or (tenant_id = (select app.current_tenant_id()) and app.can_see_task(task_id)));

-- ---------------------------------------------------------------------------
-- 6. Privileges. 002's blanket anon revoke ran before this table existed.
-- ---------------------------------------------------------------------------

revoke all on public.board_members from anon;
grant select, insert, update, delete on public.board_members to authenticated;
grant all on public.board_members to service_role;

-- ---------------------------------------------------------------------------
-- 7. Realtime — so a board list updates when someone is added to a board.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.board_members'; exception when duplicate_object then null; end;
  end if;
end $$;

alter table public.board_members replica identity full;

-- ---------------------------------------------------------------------------
-- 8. Backfill — once.
--
-- Every existing board is a tenant's "General" board: its columns and cards
-- are already attached to it (`board_id` has been NOT NULL since 001), so
-- nothing moves. What is new is the roster: everyone assigned to, or who
-- raised, a card on it joins. A tenant that somehow has columns or cards but
-- no board row cannot exist (the foreign keys forbid it), so no board needs
-- inventing.
-- ---------------------------------------------------------------------------

do $$
begin
  if coalesce(obj_description('public.board_members'::regclass, 'pg_class'), '') like '%[backfilled:038]%' then
    return;
  end if;

  insert into public.board_members (board_id, profile_id, tenant_id)
  select distinct t.board_id, ta.profile_id, t.tenant_id
    from public.task_assignees ta
    join public.tasks t on t.id = ta.task_id
    join public.profiles p on p.id = ta.profile_id and p.tenant_id = t.tenant_id
  on conflict do nothing;

  insert into public.board_members (board_id, profile_id, tenant_id)
  select distinct t.board_id, t.created_by, t.tenant_id
    from public.tasks t
    join public.profiles p on p.id = t.created_by and p.tenant_id = t.tenant_id
   where p.role = 'employee'
  on conflict do nothing;

  comment on table public.board_members is
    'Who is on a task board. Employees see only boards they are members of. [backfilled:038]';
end $$;
