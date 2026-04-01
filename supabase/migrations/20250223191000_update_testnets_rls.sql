-- Reset and align RLS policies for the public.testnets table
alter table public.testnets enable row level security;
alter table public.testnets force row level security;

drop policy if exists read_public on public.testnets;
drop policy if exists write_admin on public.testnets;
drop policy if exists update_admin on public.testnets;
drop policy if exists write_admin_insert on public.testnets;
drop policy if exists write_admin_update on public.testnets;

create policy read_public
  on public.testnets
  for select
  using (true);

create policy write_admin
  on public.testnets
  for insert
  to public
  with check (auth.role() = 'service_role');

create policy update_admin
  on public.testnets
  for update
  to public
  using (auth.role() = 'service_role');
