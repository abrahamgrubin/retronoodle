-- Local dev seed: one Demo Team plus the 4 built-in templates (RN-002 technical note; template
-- content is finalized in RN-007). This is local-dev-only convenience data, not production seed
-- data — the production Demo Team used for the RN-029 demo retro is created through real Google
-- sign-in, not this file.
--
-- IDs below use 4000-8000 (a valid v4-shaped version/variant) rather than plain zeros — Zod's
-- z.string().uuid() enforces RFC 4122's version/variant nibbles, and an all-zero id other than
-- the literal nil UUID fails that check. Found live by RN-006, the first story to validate one
-- of these seeded ids (a template id) through a zod .uuid() schema.

-- A synthetic auth user so `teams.created_by` has somewhere to point on a fresh local stack.
-- Never used to sign in; RN-003 wires up real Google sign-in.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-0000000000d0',
  'authenticated',
  'authenticated',
  'demo@retronoodle.com',
  '',
  now(),
  '{"provider":"google","providers":["google"]}',
  '{"full_name":"Demo Facilitator"}',
  now(),
  now(),
  '', '', '', ''
);

insert into public.profiles (id, display_name, email, avatar_url, timezone) values (
  '00000000-0000-4000-8000-0000000000d0',
  'Demo Facilitator',
  'demo@retronoodle.com',
  null,
  'UTC'
);

insert into public.teams (id, name, created_by, retro_cadence_days) values (
  '00000000-0000-4000-8000-0000000000d1',
  'Demo Team',
  '00000000-0000-4000-8000-0000000000d0',
  14
);

insert into public.team_members (team_id, user_id, role) values (
  '00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000d0',
  'admin'
);

-- Built-in templates. Column colors cycle green, pink, yellow, purple in template order; the
-- code appends a blue Action items column at retro start (RN-007) — never stored here.
insert into public.templates (id, team_id, source, name, columns) values
  (
    '00000000-0000-4000-8000-0000000000e1',
    null,
    'builtin',
    'Start / Stop / Continue',
    '[
      {"title": "Start", "prompt": "What should we start doing?", "color": "green"},
      {"title": "Stop", "prompt": "What should we stop doing?", "color": "pink"},
      {"title": "Continue", "prompt": "What should we keep doing?", "color": "yellow"}
    ]'::jsonb
  ),
  (
    '00000000-0000-4000-8000-0000000000e2',
    null,
    'builtin',
    'Mad / Sad / Glad',
    '[
      {"title": "Mad", "prompt": "What frustrated you?", "color": "green"},
      {"title": "Sad", "prompt": "What disappointed you?", "color": "pink"},
      {"title": "Glad", "prompt": "What made you happy?", "color": "yellow"}
    ]'::jsonb
  ),
  (
    '00000000-0000-4000-8000-0000000000e3',
    null,
    'builtin',
    '4Ls',
    '[
      {"title": "Liked", "prompt": "What did you like?", "color": "green"},
      {"title": "Learned", "prompt": "What did you learn?", "color": "pink"},
      {"title": "Lacked", "prompt": "What was missing?", "color": "yellow"},
      {"title": "Longed for", "prompt": "What did you wish for?", "color": "purple"}
    ]'::jsonb
  ),
  (
    '00000000-0000-4000-8000-0000000000e4',
    null,
    'builtin',
    'Sailboat',
    '[
      {"title": "Wind", "prompt": "What is pushing us forward?", "color": "green"},
      {"title": "Anchor", "prompt": "What is holding us back?", "color": "pink"},
      {"title": "Rocks", "prompt": "What risks are ahead?", "color": "yellow"},
      {"title": "Island", "prompt": "What is our goal?", "color": "purple"}
    ]'::jsonb
  );
