-- Dewrk Supabase schema extension for testnets single-page architecture
-- Idempotent migration: creates/extends table, indexes, RLS, and utility RPCs.

-- Ensure pgcrypto is available for UUID generation
create extension if not exists "pgcrypto";

do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name   = 'testnets'
  ) then
    create table public.testnets (
      "id" uuid primary key default gen_random_uuid(),
      "name" text not null,
      "slug" text not null unique,
      "status" text not null default 'UPCOMING',
      "network" text not null,
      "difficulty" text not null,
      "shortDescription" text,
      "heroImageUrl" text,
      "logoUrl" text,
      "description" text,
      "estTimeMinutes" integer,
      "rewardType" text,
      "rewardNote" text,
      "kycRequired" boolean not null default false,
      "requiresWallet" boolean not null default true,
      "tags" jsonb not null default '[]'::jsonb,
      "categories" jsonb not null default '[]'::jsonb,
      "highlights" jsonb not null default '[]'::jsonb,
      "prerequisites" jsonb not null default '[]'::jsonb,
      "gettingStarted" jsonb not null default '[]'::jsonb,
      "websiteUrl" text,
      "githubUrl" text,
      "twitterUrl" text,
      "discordUrl" text,
      "dashboardUrl" text,
      "hasDashboard" boolean not null default false,
      "totalRaisedUSD" numeric(18, 2),
      "discordRoles" jsonb not null default '[]'::jsonb,
      "tasksCount" integer not null default 0,
      "createdAt" timestamptz not null default now(),
      "updatedAt" timestamptz not null default now()
    );
  end if;
end
$$;

-- Ensure required columns exist with expected types/defaults
alter table public.testnets
  add column if not exists "description" text,
  add column if not exists "websiteUrl" text,
  add column if not exists "githubUrl" text,
  add column if not exists "twitterUrl" text,
  add column if not exists "discordUrl" text,
  add column if not exists "dashboardUrl" text,
  add column if not exists "hasDashboard" boolean not null default false,
  add column if not exists "totalRaisedUSD" numeric(18, 2),
  add column if not exists "discordRoles" jsonb not null default '[]'::jsonb,
  add column if not exists "highlights" jsonb not null default '[]'::jsonb,
  add column if not exists "prerequisites" jsonb not null default '[]'::jsonb,
  add column if not exists "gettingStarted" jsonb not null default '[]'::jsonb,
  add column if not exists "tasksCount" integer not null default 0,
  add column if not exists "updatedAt" timestamptz not null default now();

-- Normalize defaults for jsonb arrays if the column already existed
update public.testnets
set
  "discordRoles"  = coalesce("discordRoles",  '[]'::jsonb),
  "highlights"    = coalesce("highlights",    '[]'::jsonb),
  "prerequisites" = coalesce("prerequisites", '[]'::jsonb),
  "gettingStarted"= coalesce("gettingStarted",'[]'::jsonb)
where true;

-- Indexes to support filtering and sorting
create index if not exists testnets_status_idx on public.testnets ("status");
create index if not exists testnets_network_idx on public.testnets ("network");
create index if not exists testnets_difficulty_idx on public.testnets ("difficulty");
create index if not exists testnets_updated_at_desc_idx on public.testnets ("updatedAt" desc);
create index if not exists testnets_tags_gin_idx on public.testnets using gin ("tags");
create index if not exists testnets_categories_gin_idx on public.testnets using gin ("categories");

-- Enable and enforce RLS
alter table public.testnets enable row level security;
alter table public.testnets force row level security;

-- Allow public read access
do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'testnets'
      and policyname = 'read_public'
  ) then
    create policy "read_public"
      on public.testnets
      for select
      using (true);
  end if;
end
$policy$;

-- Restrict writes to service role or optional admin list
do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'testnets'
      and policyname = 'write_admin_insert'
  ) then
    create policy "write_admin_insert"
      on public.testnets
      for insert
      with check (
        auth.role() = 'service_role'
        or (
          to_regclass('public.admin_users') is not null
          and auth.uid() in (select user_id from public.admin_users)
        )
      );
  end if;
end
$policy$;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'testnets'
      and policyname = 'write_admin_update'
  ) then
    create policy "write_admin_update"
      on public.testnets
      for update
      using (
        auth.role() = 'service_role'
        or (
          to_regclass('public.admin_users') is not null
          and auth.uid() in (select user_id from public.admin_users)
        )
      )
      with check (true);
  end if;
end
$policy$;

-- Optional delete support for admins (keeps CRUD consistent)
do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'testnets'
      and policyname = 'write_admin_delete'
  ) then
    create policy "write_admin_delete"
      on public.testnets
      for delete
      using (
        auth.role() = 'service_role'
        or (
          to_regclass('public.admin_users') is not null
          and auth.uid() in (select user_id from public.admin_users)
        )
      );
  end if;
end
$policy$;

-- RPC: Upsert testnet from JSON payload, ensuring updatedAt freshness
create or replace function public.upsert_testnet(payload jsonb)
returns public.testnets
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.testnets;
begin
  if not (payload ? 'slug') then
    raise exception 'Payload must include slug';
  end if;

  insert into public.testnets as t (
    "id",
    "name",
    "slug",
    "status",
    "network",
    "difficulty",
    "shortDescription",
    "heroImageUrl",
    "logoUrl",
    "description",
    "estTimeMinutes",
    "rewardType",
    "rewardNote",
    "kycRequired",
    "requiresWallet",
    "tags",
    "categories",
    "highlights",
    "prerequisites",
    "gettingStarted",
    "websiteUrl",
    "githubUrl",
    "twitterUrl",
    "discordUrl",
    "dashboardUrl",
    "hasDashboard",
    "totalRaisedUSD",
    "discordRoles",
    "tasksCount",
    "createdAt",
    "updatedAt"
  )
  select
    coalesce((payload->>'id')::uuid, gen_random_uuid()),
    payload->>'name',
    payload->>'slug',
    coalesce(payload->>'status', 'UPCOMING'),
    payload->>'network',
    payload->>'difficulty',
    payload->>'shortDescription',
    payload->>'heroImageUrl',
    payload->>'logoUrl',
    payload->>'description',
    nullif(payload->>'estTimeMinutes', '')::integer,
    payload->>'rewardType',
    payload->>'rewardNote',
    coalesce(nullif(payload->>'kycRequired', '')::boolean, false),
    coalesce(nullif(payload->>'requiresWallet', '')::boolean, true),
    coalesce(payload->'tags', '[]'::jsonb),
    coalesce(payload->'categories', '[]'::jsonb),
    coalesce(payload->'highlights', '[]'::jsonb),
    coalesce(payload->'prerequisites', '[]'::jsonb),
    coalesce(payload->'gettingStarted', '[]'::jsonb),
    payload->>'websiteUrl',
    payload->>'githubUrl',
    payload->>'twitterUrl',
    payload->>'discordUrl',
    payload->>'dashboardUrl',
    coalesce(nullif(payload->>'hasDashboard', '')::boolean, false),
    nullif(payload->>'totalRaisedUSD', '')::numeric,
    coalesce(payload->'discordRoles', '[]'::jsonb),
    coalesce(nullif(payload->>'tasksCount', '')::integer, 0),
    coalesce(nullif(payload->>'createdAt', '')::timestamptz, now()),
    now()
  )
  on conflict ("slug") do update
  set
    "name"           = excluded."name",
    "status"         = excluded."status",
    "network"        = excluded."network",
    "difficulty"     = excluded."difficulty",
    "shortDescription" = excluded."shortDescription",
    "heroImageUrl"   = excluded."heroImageUrl",
    "logoUrl"        = excluded."logoUrl",
    "description"    = excluded."description",
    "estTimeMinutes" = excluded."estTimeMinutes",
    "rewardType"     = excluded."rewardType",
    "rewardNote"     = excluded."rewardNote",
    "kycRequired"    = excluded."kycRequired",
    "requiresWallet" = excluded."requiresWallet",
    "tags"           = excluded."tags",
    "categories"     = excluded."categories",
    "highlights"     = excluded."highlights",
    "prerequisites"  = excluded."prerequisites",
    "gettingStarted" = excluded."gettingStarted",
    "websiteUrl"     = excluded."websiteUrl",
    "githubUrl"      = excluded."githubUrl",
    "twitterUrl"     = excluded."twitterUrl",
    "discordUrl"     = excluded."discordUrl",
    "dashboardUrl"   = excluded."dashboardUrl",
    "hasDashboard"   = excluded."hasDashboard",
    "totalRaisedUSD" = excluded."totalRaisedUSD",
    "discordRoles"   = excluded."discordRoles",
    "tasksCount"     = excluded."tasksCount",
    "updatedAt"      = now();

  select *
  into result
  from public.testnets
  where "slug" = payload->>'slug';

  return result;
end;
$$;

-- RPC: Increment tasksCount by delta for a slug
create or replace function public.increment_tasks(slug text, delta integer)
returns public.testnets
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_record public.testnets;
begin
  update public.testnets
  set
    "tasksCount" = greatest(0, coalesce("tasksCount", 0) + coalesce(delta, 0)),
    "updatedAt"  = now()
  where "slug" = increment_tasks.slug
  returning * into updated_record;

  if not found then
    raise exception 'testnet with slug % not found', slug using errcode = 'P0002';
  end if;

  return updated_record;
end;
$$;

grant execute on function public.upsert_testnet(jsonb) to public;
grant execute on function public.increment_tasks(text, integer) to public;
