-- Community stage 1: gyms, opt-in discovery, friend requests, blocks, reports, rate limits.
-- Separate accounts: A, B, C at gym G1; D at gym G2; E without a gym.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-00000000000a', 'sa@example.com', '{"display_name":"Anna"}'),
  ('b0000000-0000-0000-0000-00000000000b', 'sb@example.com', '{"display_name":"Ben"}'),
  ('c0000000-0000-0000-0000-00000000000c', 'sc@example.com', '{"display_name":"Cleo"}'),
  ('d0000000-0000-0000-0000-00000000000d', 'sd@example.com', '{"display_name":"Dario"}'),
  ('e0000000-0000-0000-0000-00000000000e', 'se@example.com', '{"display_name":"Elsa"}');

create or replace function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
$$;

set role authenticated;

-- ---------- gyms ----------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ declare r jsonb; r2 jsonb; begin
  r := public.add_gym('FitLab Navigli', 'FitLab', 'Via Vigevano 12', 'Milano', 'it');
  assert (r->>'created')::boolean, 'gym created';
  -- Same branch with different spacing/case/punctuation returns the existing gym.
  r2 := public.add_gym('fitlab  navigli', null, 'Via Vigevano, 12', 'MILANO', 'IT');
  assert not (r2->>'created')::boolean and r2->>'id' = r->>'id', 'duplicate returns existing';
  -- Another branch of the same chain is a separate gym.
  r2 := public.add_gym('FitLab Isola', 'FitLab', 'Via Borsieri 3', 'Milano', 'IT');
  assert (r2->>'created')::boolean and r2->>'id' <> r->>'id', 'other branch separate';
  assert (select verified from public.gyms where id = (r->>'id')::uuid) = false, 'unofficial by default';
end $$;

do $$ begin
  begin
    insert into public.gyms (name, address, city, country, dedupe_key) values ('X', 'Y street', 'Z', 'IT', 'x');
    raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
  begin
    update public.gyms set verified = true;
    -- RLS: no update policy means zero rows updated
    assert (select count(*) from public.gyms where verified) = 0, 'cannot verify';
  end;
end $$;

-- rate limit: 5 new gyms a day
do $$ declare i int; r jsonb; begin
  for i in 1..3 loop
    r := public.add_gym('Gym ' || i, null, 'Street ' || i, 'Roma', 'IT');
    assert (r->>'created')::boolean, 'created ' || i;
  end loop;
  r := public.add_gym('Gym 9', null, 'Street 9', 'Roma', 'IT');
  assert r->>'error' = 'rate_limited', 'gym rate limit';
  -- an existing gym is still returned when rate limited
  r := public.add_gym('Gym 1', null, 'Street 1', 'Roma', 'IT');
  assert r->>'id' is not null, 'existing still found';
end $$;

reset role;
create temp table ids as select
  (select id from public.gyms where name = 'FitLab Navigli') as g1,
  (select id from public.gyms where name = 'FitLab Isola') as g2;
grant select on ids to authenticated;
set role authenticated;

-- ---------- memberships and discovery ----------
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.gym_memberships (gym_id) select g1 from ids;
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
insert into public.gym_memberships (gym_id, discoverable) select g1, true from ids;
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
insert into public.gym_memberships (gym_id) select g1 from ids;
select pg_temp.as_user('d0000000-0000-0000-0000-00000000000d');
insert into public.gym_memberships (gym_id, discoverable) select g2, true from ids;

do $$ begin
  assert (select count(*) from public.gym_memberships) = 1, 'D sees only own membership';
  -- D (other gym) sees nobody at G1, even opted-in B.
  assert (select count(*) from public.gym_people((select g1 from ids))) = 0, 'other gym sees nobody';
  assert (public.gym_counts((select g1 from ids))->>'visible_members')::int = 0, 'no counts for non-members';
end $$;

select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin
  -- A sees B (opted in) but not C (discovery off). A's own discovery is off.
  assert (select array_agg(display_name) from public.gym_people((select g1 from ids))) = array['Ben'], 'A sees only opted-in B';
  assert (public.gym_counts((select g1 from ids))->>'visible_members')::int = 1, 'real visible count';
  -- Only names are exposed: no email, no workouts.
  assert (select count(*) from public.profiles) = 1, 'profiles stay private';
end $$;

select pg_temp.as_user('e0000000-0000-0000-0000-00000000000e');
do $$ begin
  assert (select count(*) from public.gym_people((select g1 from ids))) = 0, 'no gym sees nobody';
  -- E cannot request B (not at E's gym).
  assert public.send_friend_request('b0000000-0000-0000-0000-00000000000b') = 'unavailable', 'stranger without gym blocked';
end $$;

select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin
  -- C did not opt in: A cannot request C.
  assert public.send_friend_request('c0000000-0000-0000-0000-00000000000c') = 'unavailable', 'discovery off blocks requests';
  assert public.send_friend_request('b0000000-0000-0000-0000-00000000000b') = 'sent', 'request sent';
  assert public.send_friend_request('b0000000-0000-0000-0000-00000000000b') = 'already_sent', 'no duplicate';
  assert (select count(*) from public.friend_requests) = 1, 'one request';
  assert (select relation from public.gym_people((select g1 from ids))) = 'request_sent', 'relation shown';
end $$;

-- B declines; A must wait; after two declines A can never ask again.
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select direction from public.my_friend_requests()) = 'incoming', 'B sees incoming';
  assert (select display_name from public.my_friend_requests()) = 'Anna', 'with name';
  assert public.respond_friend_request((select id from public.friend_requests), false) = 'declined', 'declined';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin
  assert public.send_friend_request('b0000000-0000-0000-0000-00000000000b') = 'too_soon', 'cool-down after decline';
end $$;
reset role;
update public.friend_requests set responded_at = now() - interval '31 days';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin assert public.send_friend_request('b0000000-0000-0000-0000-00000000000b') = 'sent', 'can ask again later'; end $$;
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
do $$ begin assert public.respond_friend_request((select id from public.friend_requests where status = 'pending'), false) = 'declined', 'declined twice'; end $$;
reset role;
update public.friend_requests set responded_at = now() - interval '60 days';
set role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin assert public.send_friend_request('b0000000-0000-0000-0000-00000000000b') = 'unavailable', 'no third attempt'; end $$;

-- B can still ask A? A is not discoverable, so no. A opts in, then B asks and A accepts.
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
do $$ begin assert public.send_friend_request('a0000000-0000-0000-0000-00000000000a') = 'unavailable', 'A not discoverable'; end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
update public.gym_memberships set discoverable = true;
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
do $$ begin assert public.send_friend_request('a0000000-0000-0000-0000-00000000000a') = 'sent', 'B asks A'; end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin
  -- A sending back accepts B's pending request instead of being refused.
  assert public.send_friend_request('b0000000-0000-0000-0000-00000000000b') = 'accepted', 'mutual accepts';
  assert (select array_agg(display_name) from public.my_friends()) = array['Ben'], 'A friends with B';
  assert public.is_friend('b0000000-0000-0000-0000-00000000000b'), 'is_friend';
  assert (select count(*) from public.friendships) = 1, 'friendship visible to participant';
end $$;
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from public.friendships) = 0, 'C cannot see A-B friendship';
  assert (select count(*) from public.friend_requests) = 0, 'C cannot see their requests';
  assert not public.is_friend('a0000000-0000-0000-0000-00000000000a'), 'C not friend';
end $$;

-- Changing gym switches discovery off; leaving stops discovery immediately.
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
update public.gym_memberships set gym_id = (select g2 from ids);
do $$ begin assert (select discoverable from public.gym_memberships) = false, 'discovery off after gym change'; end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from public.gym_people((select g1 from ids))) = 0, 'B gone from G1'; end $$;
select pg_temp.as_user('d0000000-0000-0000-0000-00000000000d');
do $$ begin assert (select count(*) from public.gym_people((select g2 from ids))) = 0, 'B not discoverable at G2 either'; end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
delete from public.gym_memberships;
do $$ begin assert (select count(*) from public.gym_people((select g1 from ids))) = 0, 'left: sees nobody'; end $$;
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
update public.gym_memberships set discoverable = true;
do $$ begin assert (select count(*) from public.gym_people((select g1 from ids))) = 0, 'A no longer listed after leaving'; end $$;

-- Unfriend.
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
do $$ begin
  assert public.remove_friend('a0000000-0000-0000-0000-00000000000a') = 'removed', 'unfriended';
  assert not public.is_friend('a0000000-0000-0000-0000-00000000000a'), 'no longer friends';
end $$;

-- ---------- invite links ----------
select pg_temp.as_user('e0000000-0000-0000-0000-00000000000e');
reset role;
create temp table inv (code text);
grant all on inv to authenticated;
set role authenticated;
insert into inv select public.create_friend_invite();
do $$ begin assert (public.friend_invite_preview((select code from inv))->>'status') = 'own', 'own invite'; end $$;
select pg_temp.as_user('d0000000-0000-0000-0000-00000000000d');
do $$ begin
  assert (public.friend_invite_preview((select code from inv))->>'display_name') = 'Elsa', 'preview shows inviter';
  assert public.accept_friend_invite((select code from inv)) = 'accepted', 'accepted';
  assert public.accept_friend_invite((select code from inv)) = 'invalid', 'single use';
  assert public.is_friend('e0000000-0000-0000-0000-00000000000e'), 'friends via link';
  assert (select count(*) from public.friend_invites) = 0, 'D cannot read E invites';
end $$;

-- ---------- blocking ----------
select pg_temp.as_user('e0000000-0000-0000-0000-00000000000e');
do $$ begin
  assert public.block_user('d0000000-0000-0000-0000-00000000000d') = 'blocked', 'blocked';
  assert not public.is_friend('d0000000-0000-0000-0000-00000000000d'), 'block removes friendship';
  assert (select count(*) from public.my_blocked()) = 1, 'E sees block';
end $$;
select pg_temp.as_user('d0000000-0000-0000-0000-00000000000d');
do $$ begin
  assert (select count(*) from public.blocks) = 0, 'blocked person does not see the block';
  assert (select count(*) from public.my_friends()) = 0, 'D lost E';
end $$;
select pg_temp.as_user('e0000000-0000-0000-0000-00000000000e');
reset role; truncate inv; set role authenticated;
insert into inv select public.create_friend_invite();
select pg_temp.as_user('d0000000-0000-0000-0000-00000000000d');
do $$ begin
  assert (public.friend_invite_preview((select code from inv))->>'status') = 'invalid', 'blocked cannot preview';
  assert public.accept_friend_invite((select code from inv)) = 'invalid', 'blocked cannot accept';
end $$;

-- Block hides discovery both ways and cancels pending requests.
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
insert into public.gym_memberships (gym_id, discoverable) select g1, true from ids;
do $$ begin assert public.send_friend_request('c0000000-0000-0000-0000-00000000000c') = 'sent', 'A asks C'; end $$;
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
do $$ begin
  assert public.block_user('a0000000-0000-0000-0000-00000000000a') = 'blocked', 'C blocks A';
  assert (select count(*) from public.my_friend_requests()) = 0, 'request cancelled';
  assert (select count(*) from public.gym_people((select g1 from ids))) = 0, 'C no longer sees A';
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from public.gym_people((select g1 from ids))) = 0, 'A no longer sees C';
  assert public.send_friend_request('c0000000-0000-0000-0000-00000000000c') = 'unavailable', 'no request after block';
end $$;
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
do $$ begin assert public.unblock_user('a0000000-0000-0000-0000-00000000000a') = 'unblocked', 'unblock'; end $$;

-- ---------- reports and restriction ----------
select pg_temp.as_user('e0000000-0000-0000-0000-00000000000e');
do $$ begin
  -- E blocked D, so E can report D.
  assert public.report_content('user', 'd0000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-00000000000d', 'spam', 'x') = 'reported', 'E reports D';
  assert public.report_content('user', 'd0000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-00000000000d', 'spam', null) = 'already_reported', 'once';
  -- E has no connection to C: refused.
  assert public.report_content('user', 'c0000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-00000000000c', 'spam', null) = 'invalid', 'no connection';
end $$;
select pg_temp.as_user('d0000000-0000-0000-0000-00000000000d');
do $$ begin assert (select count(*) from public.reports) = 0, 'reported user cannot read reports'; end $$;

-- Three different reporters restrict an account. A, C at G1 report B? Make B discoverable at G2 with D.
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
update public.gym_memberships set discoverable = true;
select pg_temp.as_user('d0000000-0000-0000-0000-00000000000d');
do $$ begin assert public.report_content('user', 'b0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'harassment', null) = 'reported', 'D reports B'; end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
do $$ begin assert public.report_content('user', 'b0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'harassment', null) = 'reported', 'A reports B (past requests)'; end $$;
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (public.my_social_status()->>'restricted')::boolean = false, 'two reports: not restricted';
end $$;
reset role;
insert into public.reports (reporter_id, reported_user_id, target_type, target_id, reason)
values ('c0000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-00000000000b', 'user', 'b0000000-0000-0000-0000-00000000000b', 'spam');
set role authenticated;
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (public.my_social_status()->>'restricted')::boolean, 'three reporters: restricted';
  assert public.send_friend_request('d0000000-0000-0000-0000-00000000000d') = 'restricted', 'restricted cannot request';
  begin perform public.create_friend_invite(); raise exception 'should have failed';
  exception when others then if sqlerrm <> 'restricted' then raise; end if; end;
end $$;
reset role;
update public.reports set status = 'dismissed' where reported_user_id = 'b0000000-0000-0000-0000-00000000000b';
set role authenticated;
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
do $$ begin assert (public.my_social_status()->>'restricted')::boolean = false, 'review lifts restriction'; end $$;

-- Friend-request rate limit: 20 a day.
reset role;
insert into auth.users (id, email) select ('f0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'f' || i || '@example.com' from generate_series(1, 21) i;
insert into public.gym_memberships (user_id, gym_id, discoverable)
select ('f0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, (select g2 from ids), false from generate_series(1, 21) i;
update public.gym_memberships set discoverable = true where user_id::text like 'f0000000%';
set role authenticated;
select pg_temp.as_user('d0000000-0000-0000-0000-00000000000d');
do $$ declare i int; begin
  for i in 1..20 loop
    assert public.send_friend_request(('f0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid) = 'sent', 'sent ' || i;
  end loop;
  assert public.send_friend_request('f0000000-0000-0000-0000-000000000021') = 'rate_limited', 'request rate limit';
end $$;

-- Anonymous callers get nothing.
reset role;
set role anon;
do $$ begin
  begin perform public.gym_people((select id from public.gyms limit 1)); raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.gyms) = 0, 'anon cannot list gyms';
end $$;
reset role;
