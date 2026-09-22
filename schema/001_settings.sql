-- ============================================================================
-- PEAK — published site settings
-- ============================================================================
--
-- WHY THIS TABLE EXISTS
--
-- The contract address was a build-time constant inside index.html, so putting
-- the CA on the site meant editing source, committing, deploying and waiting —
-- on a site that is already live. The same was true of every label, the banner
-- copy and the two social links.
--
-- These are the values that change what a VISITOR sees, so they belong on the
-- server. They are written through /api/settings, which is the only thing
-- holding the two secrets:
--
--   ADMIN_SECRET                 the operator's passphrase, sent as a header
--   SUPABASE_SERVICE_ROLE_KEY    bypasses RLS on peak_settings
--
-- The table has no anon INSERT or UPDATE policy, so a direct browser write
-- fails even for someone who reads the anon key out of the page. Rewriting the
-- contract address is the most damaging thing anyone could do to this site —
-- it is what people copy before they trade — so it is the last thing that
-- should be reachable from a public bundle.
--
-- ONE ROW, ENFORCED BY THE SCHEMA
--
-- `id boolean primary key default true check (id)` is the trick: the only legal
-- value is true, so there can only ever be one row. A surrogate `id serial`
-- would happily accept a second row and leave the site reading an arbitrary one
-- of them.
--
-- EVERY COLUMN IS NULLABLE, and that is deliberate. The API writes only the
-- keys it was given, so a partial publish cannot zero the fields it did not
-- mention. NULL therefore means "the operator has not overridden this", and the
-- page falls back to the value compiled into index.html — which is why the
-- seed below is empty rather than a copy of the current defaults.
--
-- ============================================================================

create table if not exists public.peak_settings (
  id             boolean primary key default true check (id),

  -- The token's mint. NULL or empty means "not launched yet", which is the
  -- state the CA band has a branch for. Base58 only: a mint that is not base58
  -- becomes a dead pump.fun button, and it is pasted into a URL.
  ca             text check (ca is null or ca ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),

  -- Branding. The symbol is stored bare ("PEAK"); the page renders it as
  -- "$PEAK". Angle brackets are refused outright — everything here is rendered
  -- with textContent, but a value that cannot be a tag is one less thing to
  -- get wrong later.
  token_symbol   text check (token_symbol is null or token_symbol ~ '^[A-Za-z0-9]{1,10}$'),
  token_name     text check (token_name is null or
                             (length(token_name) between 1 and 24 and token_name !~ '[<>]')),

  -- Links for the two icons. https only, so a stored value can never be a
  -- javascript: URL. An empty pump_url is not an error — the page derives
  -- pump.fun/coin/<CA> from the address itself.
  pump_url       text check (pump_url is null or pump_url ~ '^https://'),
  x_url          text check (x_url is null or x_url ~ '^https://'),

  -- Where the live feed comes from. Stored rather than baked in so the feed
  -- follows the CA without a redeploy.
  feed_url       text check (feed_url is null or feed_url ~ '^(https?|wss?)://'),
  rpc_url        text check (rpc_url is null or rpc_url ~ '^https://'),

  -- Banner copy. `body` is a template: {camp} {next} {mc} {alt} {sym} are
  -- substituted by the page. Hype copy stays behind the existing Compliant /
  -- Hype toggle in Feed setup — see INTEGRATION.md section 4. Nothing here
  -- changes which mode ships on by default.
  copy_safe_head text check (copy_safe_head is null or length(copy_safe_head) <= 40),
  copy_safe_body text check (copy_safe_body is null or length(copy_safe_body) <= 240),
  copy_safe_sub  text check (copy_safe_sub  is null or length(copy_safe_sub)  <= 160),
  copy_hype_head text check (copy_hype_head is null or length(copy_hype_head) <= 40),
  copy_hype_body text check (copy_hype_body is null or length(copy_hype_body) <= 240),
  copy_hype_sub  text check (copy_hype_sub  is null or length(copy_hype_sub)  <= 160),

  -- The line under the route panel. Compliance wording, so it is editable but
  -- deliberately not defaulted to anything else.
  ladder_note    text check (ladder_note is null or length(ladder_note) <= 300),

  updated_at     timestamptz not null default now(),
  -- Who last changed it. Not authentication — the server already proved the
  -- secret — just enough to answer "did I publish this, or did the other
  -- device?"
  updated_by     text
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.peak_settings enable row level security;

-- Supabase grants anon/authenticated broad privileges by default. RLS decides
-- which ROWS, the grant decides which VERBS, and both are needed: without the
-- revoke, anon could UPDATE the row it is allowed to read.
revoke all on public.peak_settings from anon, authenticated;
grant select on public.peak_settings to anon, authenticated;

drop policy if exists "peak settings are public" on public.peak_settings;
create policy "peak settings are public"
  on public.peak_settings
  for select
  to anon, authenticated
  using (true);

-- No INSERT/UPDATE policy. Writes go through /api/settings, which holds the
-- service role key and bypasses RLS. That is the whole point: the page's source
-- is public, so the ability to rewrite the contract address must not be in it.

-- Deliberately NO `force row level security` — FORCE would bind the table
-- owner, and the service role is used as the owner here.

-- ---------------------------------------------------------------------------
-- Seed the single row
-- ---------------------------------------------------------------------------
-- Seeded EMPTY on purpose. Every column is an override, so an empty row means
-- "use the values compiled into index.html" — which is the same state the site
-- was already in, and means adding this table changes nothing until somebody
-- publishes something. The CA band reads "TO BE LAUNCHED" from the fallback.
insert into public.peak_settings (id, updated_by)
values (true, 'schema')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- Anon may read exactly one row:
--   select * from public.peak_settings;
-- Anon must NOT be able to write (this must fail):
--   set local role anon;
--   update public.peak_settings set ca = 'x';
-- A bad CA must be refused by the table itself (this must fail):
--   update public.peak_settings set ca = 'not-base58!!';
-- And it must not be possible to add a second row:
--   insert into public.peak_settings (id) values (false);   -- check violation
