-- Community stage 3: posts with explicit audiences, snapshots, reactions, comments, moderation.
-- A and B friends, both at gym G; C at gym G, not a friend; D at another gym; E friend of A, no gym.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values
  ('a2000000-0000-0000-0000-00000000000a', 'pa@example.com', '{"display_name":"Anna"}'),
  ('b2000000-0000-0000-0000-00000000000b', 'pb@example.com', '{"display_name":"Ben"}'),
  ('c2000000-0000-0000-0000-00000000000c', 'pc@example.com', '{"display_name":"Cleo"}'),
  ('d2000000-0000-0000-0000-00000000000d', 'pd@example.com', '{"display_name":"Dario"}'),
  ('e2000000-0000-0000-0000-00000000000e', 'pe@example.com', '{"display_name":"Elsa"}');
insert into public.gyms (id, name, address, city, country, dedupe_key) values
  ('9b000000-0000-0000-0000-000000000001', 'Steel Club', 'Via Roma 1', 'Bologna', 'IT', 'steelclubtest'),
  ('9b000000-0000-0000-0000-000000000002', 'Other Gym', 'Via Roma 2', 'Bologna', 'IT', 'othergymtest');
insert into public.gym_memberships (user_id, gym_id) values
  ('a2000000-0000-0000-0000-00000000000a', '9b000000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-00000000000b', '9b000000-0000-0000-0000-000000000001'),
  ('c2000000-0000-0000-0000-00000000000c', '9b000000-0000-0000-0000-000000000001'),
  ('d2000000-0000-0000-0000-00000000000d', '9b000000-0000-0000-0000-000000000002');
insert into public.friendships (user_a, user_b) values
  ('a2000000-0000-0000-0000-00000000000a', 'b2000000-0000-0000-0000-00000000000b'),
  ('a2000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000e');

-- A completed workout with private details that must never be shared.
insert into public.workout_sessions (id, user_id, name, status, started_at, ended_at, notes, bodyweight_kg, energy_rating, shortfall_reason)
values ('5e550000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-00000000000a', 'Push', 'completed',
        now() - interval '2 hours', now() - interval '1 hour', 'SECRET NOTE', 81.5, 3, 'fatigue');
insert into public.exercises (id, user_id, slug, name) values ('e0e00000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-00000000000a', 'test-bench', 'Bench Press');
insert into public.session_exercises (id, user_id, session_id, exercise_id, position, notes)
values ('5e000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-00000000000a', '5e550000-0000-0000-0000-000000000001', 'e0e00000-0000-0000-0000-000000000001', 0, 'SECRET EX NOTE');
insert into public.set_logs (user_id, session_id, session_exercise_id, position, kind, weight_kg, reps, completed, notes) values
  ('a2000000-0000-0000-0000-00000000000a', '5e550000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', 0, 'warmup', 40, 10, true, null),
  ('a2000000-0000-0000-0000-00000000000a', '5e550000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', 1, 'working', 80, 8, true, 'SECRET SET NOTE'),
  ('a2000000-0000-0000-0000-00000000000a', '5e550000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', 2, 'working', 80, 7, true, null),
  ('a2000000-0000-0000-0000-00000000000a', '5e550000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', 3, 'working', 80, null, false, null);

create or replace function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
$$;
set role authenticated;

-- ---------- preview and snapshot ----------
select pg_temp.as_user('a2000000-0000-0000-0000-00000000000a');
do $$ declare p jsonb; t text; begin
  p := public.preview_workout_share('5e550000-0000-0000-0000-000000000001', '{"loads":true,"reps":true}');
  t := p::text;
  assert jsonb_array_length(p->'exercises'->0->'sets') = 2, 'only completed working sets';
  assert (p->'exercises'->0->'sets'->0->>'kg')::numeric = 80, 'load included';
  assert t not like '%SECRET%' and t not like '%81.5%' and t not like '%fatigue%' and p->'energy_rating' is null, 'private details excluded';
  p := public.preview_workout_share('5e550000-0000-0000-0000-000000000001', '{"loads":false,"reps":true,"duration":false}');
  assert p->'exercises'->0->'sets'->0->'kg' is null and p->'exercises'->0->'convention' is null, 'loads hidden';
  assert (p->'exercises'->0->'sets'->0->>'reps')::int = 8, 'reps kept';
  assert p->'duration_min' is null, 'duration hidden';
  assert public.share_workout('70000000-0000-0000-0000-000000000001', '5e550000-0000-0000-0000-000000000001', 'friends', '{"loads":false}', 'Good day') = 'shared', 'shared to friends';
  assert public.share_workout('70000000-0000-0000-0000-000000000001', '5e550000-0000-0000-0000-000000000001', 'friends', '{"loads":false}', 'Good day') = 'shared', 'idempotent';
  assert public.share_workout('70000000-0000-0000-0000-000000000009', '5e550000-0000-0000-0000-000000000001', 'friends', '{}', null) = 'already_shared', 'once per audience';
  assert public.share_workout('70000000-0000-0000-0000-000000000002', '5e550000-0000-0000-0000-000000000001', 'gym', '{}', null) = 'shared', 'shared to gym';
  assert (select count(*) from public.posts) = 2, 'two posts';
  begin
    insert into public.posts (id, kind, audience, source_session_id, snapshot) values (gen_random_uuid(), 'workout', 'friends', '5e550000-0000-0000-0000-000000000001', '{"fake":1}');
    raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
end $$;

-- Someone else's workout can't be shared or previewed.
select pg_temp.as_user('b2000000-0000-0000-0000-00000000000b');
do $$ begin
  assert public.preview_workout_share('5e550000-0000-0000-0000-000000000001', '{}') is null, 'cannot preview others';
  assert public.share_workout(gen_random_uuid(), '5e550000-0000-0000-0000-000000000001', 'friends', '{}', null) = 'not_found', 'cannot share others';
  -- B (friend, same gym) sees both posts, never the workout records.
  assert (select count(*) from public.posts) = 2, 'B sees friends + gym posts';
  assert (select count(*) from public.workout_sessions) = 0, 'B cannot read A sessions';
  assert (select count(*) from public.set_logs) = 0, 'B cannot read A sets';
  assert (select author_name from public.community_feed('friends') limit 1) = 'Anna', 'feed has name';
  assert (select count(*) from public.community_feed('gym')) = 1, 'gym feed';
end $$;
select pg_temp.as_user('c2000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from public.posts) = 1, 'C (gym, not friend) sees only the gym post';
  assert (select audience from public.posts) = 'gym', 'gym audience';
end $$;
select pg_temp.as_user('d2000000-0000-0000-0000-00000000000d');
do $$ begin assert (select count(*) from public.posts) = 0, 'other gym sees nothing'; end $$;
select pg_temp.as_user('e2000000-0000-0000-0000-00000000000e');
do $$ begin
  assert (select count(*) from public.posts) = 1, 'friend without gym sees only friends post';
  -- Joining the gym later shows gym posts made there (audience = that gym), but never widens friends posts.
end $$;

-- ---------- reactions and comments ----------
select pg_temp.as_user('b2000000-0000-0000-0000-00000000000b');
do $$ begin
  assert public.react_to_post('70000000-0000-0000-0000-000000000001', '🔥') = 'reacted', 'react';
  assert public.react_to_post('70000000-0000-0000-0000-000000000001', '💪') = 'reacted', 'change reaction';
  assert (select count(*) from public.post_reactions) = 1, 'one per person';
  begin perform public.react_to_post('70000000-0000-0000-0000-000000000001', '🍕'); raise exception 'should have failed';
  exception when check_violation then null; end;
  assert public.add_comment('c0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'Nice!') = 'added', 'comment';
  assert public.add_comment('c0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'Nice!') = 'added', 'retry';
  assert (select count(*) from public.post_comments) = 1, 'no duplicate comment';
end $$;
select pg_temp.as_user('c2000000-0000-0000-0000-00000000000c');
do $$ begin
  assert public.add_comment(gen_random_uuid(), '70000000-0000-0000-0000-000000000001', 'hi') = 'not_found', 'cannot comment on unseen post';
  assert public.react_to_post('70000000-0000-0000-0000-000000000001', '🔥') = 'not_found', 'cannot react on unseen post';
  assert (select count(*) from public.post_comments) = 0, 'cannot read comments on friends post';
  assert public.add_comment('c0000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'See you there') = 'added', 'comment on gym post';
  -- C can't delete B's comment
  delete from public.post_comments where id = 'c0000000-0000-0000-0000-000000000001';
end $$;
select pg_temp.as_user('a2000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from public.post_comments) = 2, 'author sees both comments';
  -- Post author moderates comments on own post.
  delete from public.post_comments where id = 'c0000000-0000-0000-0000-000000000002';
  assert (select count(*) from public.post_comments) = 1, 'moderated';
end $$;

-- ---------- reports hide for the reporter ----------
select pg_temp.as_user('c2000000-0000-0000-0000-00000000000c');
do $$ begin
  assert public.report_content('post', '70000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-00000000000a', 'spam', null) = 'reported', 'reported post';
  assert (select count(*) from public.posts) = 0, 'hidden for reporter';
  assert public.report_content('post', '70000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-00000000000a', 'spam', null) = 'invalid', 'cannot report unseen post';
end $$;

-- ---------- unfriend, block, leaving the gym ----------
select pg_temp.as_user('a2000000-0000-0000-0000-00000000000a');
do $$ begin assert public.remove_friend('e2000000-0000-0000-0000-00000000000e') = 'removed', 'unfriend E'; end $$;
select pg_temp.as_user('e2000000-0000-0000-0000-00000000000e');
do $$ begin assert (select count(*) from public.posts) = 0, 'unfriended: posts hidden'; end $$;

select pg_temp.as_user('b2000000-0000-0000-0000-00000000000b');
do $$ begin
  assert public.block_user('a2000000-0000-0000-0000-00000000000a') = 'blocked', 'B blocks A';
  assert (select count(*) from public.posts) = 0, 'blocked: gym and friends posts hidden';
  assert (select count(*) from public.post_comments) = 0, 'blocked: comments hidden';
end $$;
select pg_temp.as_user('a2000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from public.post_reactions) = 0, 'A no longer sees B reaction';
  assert (select count(*) from public.post_comments) = 0, 'A no longer sees B comment';
  assert (select comment_count from public.community_feed('mine') where id = '70000000-0000-0000-0000-000000000001') = 0, 'counts respect blocks';
end $$;
reset role; delete from public.blocks; set role authenticated;

-- Leaving the gym hides your gym posts there; rejoining shows them again.
select pg_temp.as_user('a2000000-0000-0000-0000-00000000000a');
delete from public.gym_memberships;
select pg_temp.as_user('b2000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from public.posts where audience = 'gym') = 0, 'author left: gym post hidden';
end $$;
-- B leaving makes gym posts invisible to B as well.
select pg_temp.as_user('a2000000-0000-0000-0000-00000000000a');
insert into public.gym_memberships (gym_id) values ('9b000000-0000-0000-0000-000000000001');
select pg_temp.as_user('b2000000-0000-0000-0000-00000000000b');
delete from public.gym_memberships;
do $$ begin assert (select count(*) from public.posts where audience = 'gym') = 0, 'viewer left: gym post hidden'; end $$;
insert into public.gym_memberships (gym_id) values ('9b000000-0000-0000-0000-000000000001');

-- ---------- buddy invitations ----------
select pg_temp.as_user('c2000000-0000-0000-0000-00000000000c');
do $$ begin
  assert public.post_buddy_invite('80000000-0000-0000-0000-000000000001', 'gym', now() + interval '1 day', 'Europe/Rome', 'Legs', 'Need a spotter') = 'shared', 'buddy posted';
  assert public.post_buddy_invite(gen_random_uuid(), 'gym', now() + interval '1 day', 'Nowhere/Zone', null, null) = 'invalid_time_zone', 'tz';
end $$;
select pg_temp.as_user('b2000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from public.community_feed('buddy')) = 1, 'B sees buddy invite at the gym';
  assert (public.gym_activity('9b000000-0000-0000-0000-000000000001')->>'buddy_upcoming')::int = 1, 'activity count';
end $$;
select pg_temp.as_user('d2000000-0000-0000-0000-00000000000d');
do $$ begin assert (select count(*) from public.community_feed('buddy')) = 0, 'other gym: none'; end $$;
select pg_temp.as_user('e2000000-0000-0000-0000-00000000000e');
do $$ begin
  assert public.post_buddy_invite(gen_random_uuid(), 'gym', now() + interval '1 day', 'UTC', null, null) = 'no_gym', 'no gym';
end $$;

-- ---------- deleting the source workout deletes its posts; editing doesn't change them ----------
reset role;
update public.set_logs set weight_kg = 200 where session_id = '5e550000-0000-0000-0000-000000000001';
do $$ begin
  assert (select (snapshot->'exercises'->0->'sets'->0->>'reps')::int from public.posts where id = '70000000-0000-0000-0000-000000000002') = 8, 'snapshot unchanged by edits';
  assert (select snapshot::text from public.posts where id = '70000000-0000-0000-0000-000000000002') not like '%200%', 'no edited load';
end $$;
delete from public.workout_sessions where id = '5e550000-0000-0000-0000-000000000001';
do $$ begin assert (select count(*) from public.posts where kind = 'workout') = 0, 'workout deletion removes posts'; end $$;
