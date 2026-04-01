-- Extend testnets with rich admin fields
alter table public.testnets
  add column if not exists "tasks" jsonb not null default '[]'::jsonb,
  add column if not exists "published" boolean not null default false;

-- Backfill nullable values just in case
update public.testnets
set
  "tasks" = coalesce("tasks", '[]'::jsonb),
  "published" = coalesce("published", false);

-- Refresh tasksCount based on tasks array if missing
update public.testnets
set "tasksCount" = coalesce(jsonb_array_length("tasks"), "tasksCount")
where coalesce("tasksCount", 0) = 0;

-- Update upsert function to handle new fields
create or replace function public.upsert_testnet(payload jsonb)
returns public.testnets
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.testnets;
  incoming_tasks jsonb := coalesce(payload->'tasks', '[]'::jsonb);
  incoming_tasks_count integer := coalesce(jsonb_array_length(payload->'tasks'), nullif(payload->>'tasksCount', '')::integer, 0);
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
    "tasks",
    "tasksCount",
    "published",
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
    incoming_tasks,
    coalesce(incoming_tasks_count, 0),
    coalesce(nullif(payload->>'published', '')::boolean, false),
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
    "tasks"          = excluded."tasks",
    "tasksCount"     = coalesce(jsonb_array_length(excluded."tasks"), excluded."tasksCount"),
    "published"      = excluded."published",
    "updatedAt"      = now();

  select *
  into result
  from public.testnets
  where "slug" = payload->>'slug';

  return result;
end;
$$;
