-- Community stage 2: messages and training invitations, with separate accounts.
-- A and B friends; C at the same gym but not a friend; D stranger.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-00000000000a', 'ma@example.com', '{"display_name":"Anna"}'),
  ('b1000000-0000-0000-0000-00000000000b', 'mb@example.com', '{"display_name":"Ben"}'),
  ('c1000000-0000-0000-0000-00000000000c', 'mc@example.com', '{"display_name":"Cleo"}'),
  ('d1000000-0000-0000-0000-00000000000d', 'md@example.com', '{"display_name":"Dario"}');
insert into public.gyms (id, name, address, city, country, dedupe_key)
values ('9a000000-0000-0000-0000-000000000001', 'Iron Den', 'Via Po 1', 'Torino', 'IT', 'irondentest');
insert into public.gym_memberships (user_id, gym_id, discoverable) values
  ('a1000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-000000000001', true),
  ('c1000000-0000-0000-0000-00000000000c', '9a000000-0000-0000-0000-000000000001', true);
insert into public.friendships (user_a, user_b) values ('a1000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-00000000000b');

create or replace function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
$$;
set role authenticated;

-- ---------- messaging ----------
select pg_temp.as_user('a1000000-0000-0000-0000-00000000000a');
do $$ declare r jsonb; begin
  r := public.send_message('11111111-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b', '  Hi Ben  ');
  assert r->>'status' = 'sent', 'sent to friend';
  -- retry with the same id: no duplicate
  r := public.send_message('11111111-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b', 'Hi Ben');
  assert r->>'status' = 'sent', 'retry ok';
  assert (select count(*) from public.messages) = 1, 'no duplicate on retry';
  assert (select body from public.messages) = 'Hi Ben', 'trimmed';
  -- same gym, not friends: refused
  assert public.send_message('11111111-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-00000000000c', 'hey')->>'status' = 'not_friends', 'gym alone is not enough';
  assert public.send_message('11111111-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-00000000000d', 'hey')->>'status' = 'not_friends', 'stranger refused';
  assert public.send_message('11111111-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-00000000000b', '   ')->>'status' = 'invalid', 'empty refused';
  begin
    insert into public.messages (id, conversation_id, sender_id, body) select gen_random_uuid(), id, auth.uid(), 'x' from public.conversations;
    raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
end $$;

select pg_temp.as_user('b1000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select unread from public.my_conversations()) = 1, 'B has one unread';
  assert public.unread_message_total() = 1, 'badge count';
  assert (select display_name from public.my_conversations()) = 'Anna', 'name';
  perform public.mark_conversation_read((select conversation_id from public.my_conversations()));
  assert public.unread_message_total() = 0, 'read';
  -- B reuses A's id: refused, not overwritten
  assert public.send_message('11111111-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-00000000000a', 'mine')->>'status' = 'invalid', 'cannot reuse someone else id';
  assert (public.send_message('11111111-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-00000000000a', 'Hey!')->>'status') = 'sent', 'reply';
end $$;

-- Others can't read or subscribe to the conversation (RLS covers Realtime too).
select pg_temp.as_user('c1000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from public.messages) = 0, 'C reads nothing';
  assert (select count(*) from public.conversations) = 0, 'C sees no conversation';
  assert (select count(*) from public.my_conversations()) = 0, 'C list empty';
  assert public.conversation_info((select id from public.conversations limit 1)) is null, 'no info';
  begin perform public.set_conversation_muted('00000000-0000-0000-0000-000000000000', true); raise exception 'x';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
end $$;
reset role;
create temp table conv as select id from public.conversations;
grant select on conv to authenticated;
set role authenticated;
select pg_temp.as_user('c1000000-0000-0000-0000-00000000000c');
do $$ begin
  assert public.conversation_info((select id from conv)) is null, 'C cannot read info of the A-B conversation';
  perform public.mark_conversation_read((select id from conv));
  assert (select count(*) from public.conversation_state) = 0, 'C cannot add state to it';
  begin perform public.set_conversation_muted((select id from conv), true); raise exception 'x';
  exception when others then if sqlerrm <> 'not_found' then raise; end if; end;
end $$;
set role authenticated;

-- Mute keeps messages but removes them from the badge.
select pg_temp.as_user('a1000000-0000-0000-0000-00000000000a');
do $$ begin
  assert public.unread_message_total() = 1, 'A has unread';
  perform public.set_conversation_muted((select conversation_id from public.my_conversations()), true);
  assert public.unread_message_total() = 0, 'muted not in badge';
  assert (select unread from public.my_conversations()) = 1, 'still unread in list';
end $$;

-- Report a message: hidden for the reporter only; can't report your own or a fake sender.
do $$ begin
  assert public.report_content('message', '11111111-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-00000000000b', 'spam', null) = 'reported', 'reported';
  assert (select count(*) from public.messages) = 1, 'reported message hidden for reporter';
  -- A's own message attributed to B: refused (by report_content since 021, by the trigger before).
  begin
    assert public.report_content('message', '11111111-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b', 'spam', null) = 'invalid', 'fake sender';
  exception when others then if sqlerrm <> 'invalid_report_target' then raise; end if; end;
end $$;
select pg_temp.as_user('b1000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from public.messages) = 2, 'sender still sees it'; end $$;

-- ---------- training invitations ----------
select pg_temp.as_user('a1000000-0000-0000-0000-00000000000a');
do $$ declare r jsonb; begin
  r := public.create_training_invite('22222222-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b',
        '9a000000-0000-0000-0000-000000000001', null, now() + interval '2 days', 'Europe/Rome', 'Push', 'Bring chalk');
  assert r->>'status' = 'sent', 'invite sent';
  r := public.create_training_invite('22222222-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b',
        '9a000000-0000-0000-0000-000000000001', null, now() + interval '2 days', 'Europe/Rome', 'Push', 'Bring chalk');
  assert (select count(*) from public.training_invites) = 1, 'idempotent invite';
  assert (select gym_name from public.training_invites) = 'Iron Den', 'gym name snapshot';
  assert public.create_training_invite(gen_random_uuid(), 'b1000000-0000-0000-0000-00000000000b', null, 'Somewhere', now() + interval '1 day', 'Mars/Base')->>'status' = 'invalid_time_zone', 'tz checked';
  assert public.create_training_invite(gen_random_uuid(), 'b1000000-0000-0000-0000-00000000000b', null, 'Somewhere', now() - interval '1 day', 'UTC')->>'status' = 'invalid_time', 'past refused';
  assert public.create_training_invite(gen_random_uuid(), 'c1000000-0000-0000-0000-00000000000c', null, 'Somewhere', now() + interval '1 day', 'UTC')->>'status' = 'not_friends', 'non-friend refused';
  -- A can't accept own invitation
  assert public.respond_training_invite('22222222-0000-0000-0000-000000000001', 'accept', 1) = 'not_your_turn', 'not A turn';
  -- No workout created by scheduling
  assert (select count(*) from public.workout_sessions) = 0, 'no workout created';
end $$;

select pg_temp.as_user('b1000000-0000-0000-0000-00000000000b');
do $$ begin
  -- B proposes a different time: pending, now waiting on A.
  assert public.respond_training_invite('22222222-0000-0000-0000-000000000001', 'propose', 1, now() + interval '3 days', 'Europe/London') = 'proposed', 'proposed';
  assert (select status from public.training_invites) = 'pending', 'still pending';
  assert (select awaiting_id from public.training_invites) = 'a1000000-0000-0000-0000-00000000000a', 'waiting on A';
  -- B can't accept own proposal; stale version refused
  assert public.respond_training_invite('22222222-0000-0000-0000-000000000001', 'accept', 2) = 'not_your_turn', 'proposer cannot accept';
  assert public.respond_training_invite('22222222-0000-0000-0000-000000000001', 'accept', 1) = 'stale', 'stale';
end $$;
select pg_temp.as_user('a1000000-0000-0000-0000-00000000000a');
do $$ begin
  assert public.respond_training_invite('22222222-0000-0000-0000-000000000001', 'accept', 2) = 'accepted', 'A accepts proposal';
  assert (select time_zone from public.training_invites) = 'Europe/London', 'tz stored';
  -- Reschedule after accepted: back to pending until B accepts.
  assert public.respond_training_invite('22222222-0000-0000-0000-000000000001', 'propose', 3, now() + interval '4 days', 'Europe/Rome') = 'proposed', 'reschedule';
  assert (select status from public.training_invites) = 'pending', 'reschedule needs acceptance';
  assert (select count(*) from public.messages where kind = 'invite_event') = 3, 'events logged';
end $$;
select pg_temp.as_user('c1000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from public.training_invites) = 0, 'C cannot see invitations';
  assert public.respond_training_invite('22222222-0000-0000-0000-000000000001', 'cancel', 4) = 'not_found', 'C cannot cancel';
end $$;

-- ---------- unfriend and block ----------
select pg_temp.as_user('b1000000-0000-0000-0000-00000000000b');
do $$ begin
  assert public.remove_friend('a1000000-0000-0000-0000-00000000000a') = 'removed', 'unfriend';
  assert public.send_message(gen_random_uuid(), 'a1000000-0000-0000-0000-00000000000a', 'still there?')->>'status' = 'not_friends', 'no messages after unfriend';
  -- Since migration 022, unfriending cancels open invitations for both people.
  assert (select status from public.training_invites where id = '22222222-0000-0000-0000-000000000001') = 'cancelled', 'unfriend cancels the invitation';
  assert public.respond_training_invite('22222222-0000-0000-0000-000000000001', 'accept', 5) = 'not_friends', 'no accept after unfriend';
  assert (select count(*) from public.messages) > 0, 'history readable after unfriend';
  assert (select can_send from public.my_conversations()) = 'not_friends', 'list shows why';
  assert public.respond_training_invite('22222222-0000-0000-0000-000000000001', 'cancel', 5) = 'closed', 'already closed';
end $$;
reset role;
insert into public.friendships (user_a, user_b) values ('a1000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-00000000000b');
set role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-00000000000a');
do $$ begin
  assert public.send_message(gen_random_uuid(), 'b1000000-0000-0000-0000-00000000000b', 'reconnected')->>'status' = 'sent', 'messages after reconnecting';
  assert public.create_training_invite('22222222-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-00000000000b', null, 'Park', now() + interval '1 day', 'UTC')->>'status' = 'sent', 'new invite';
end $$;
select pg_temp.as_user('b1000000-0000-0000-0000-00000000000b');
do $$ begin
  assert public.block_user('a1000000-0000-0000-0000-00000000000a') = 'blocked', 'B blocks A';
  assert (select status from public.training_invites where id = '22222222-0000-0000-0000-000000000002') = 'cancelled', 'block cancels invitations';
end $$;
select pg_temp.as_user('a1000000-0000-0000-0000-00000000000a');
do $$ begin
  assert public.send_message(gen_random_uuid(), 'b1000000-0000-0000-0000-00000000000b', 'hello?')->>'status' = 'unavailable', 'blocked: no messages';
  assert public.create_training_invite(gen_random_uuid(), 'b1000000-0000-0000-0000-00000000000b', null, 'Park', now() + interval '1 day', 'UTC')->>'status' = 'unavailable', 'blocked: no invites';
  begin perform public.open_conversation('b1000000-0000-0000-0000-00000000000b'); exception when others then null; end;
end $$;

-- ---------- rate limit ----------
reset role;
delete from public.blocks;
insert into public.friendships (user_a, user_b) values ('a1000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-00000000000b') on conflict do nothing;
set role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-00000000000a');
do $$ declare i int; n int; begin
  select count(*) into n from public.messages where sender_id = auth.uid() and created_at > now() - interval '1 minute';
  for i in (n + 1)..30 loop
    assert public.send_message(gen_random_uuid(), 'b1000000-0000-0000-0000-00000000000b', 'm' || i)->>'status' = 'sent', 'sent ' || i;
  end loop;
  assert public.send_message(gen_random_uuid(), 'b1000000-0000-0000-0000-00000000000b', 'too many')->>'status' = 'rate_limited', 'message rate limit';
end $$;

-- Restricted accounts can't message.
reset role;
insert into auth.users (id, email) values ('e1000000-0000-0000-0000-00000000000e', 'me@example.com'), ('f1000000-0000-0000-0000-00000000000f', 'mf@example.com');
alter table public.reports disable trigger check_message_report;
insert into public.reports (reporter_id, reported_user_id, target_type, target_id, reason) values
  ('c1000000-0000-0000-0000-00000000000c', 'b1000000-0000-0000-0000-00000000000b', 'user', 'b1000000-0000-0000-0000-00000000000b', 'spam'),
  ('d1000000-0000-0000-0000-00000000000d', 'b1000000-0000-0000-0000-00000000000b', 'user', 'b1000000-0000-0000-0000-00000000000b', 'spam'),
  ('e1000000-0000-0000-0000-00000000000e', 'b1000000-0000-0000-0000-00000000000b', 'user', 'b1000000-0000-0000-0000-00000000000b', 'spam');
alter table public.reports enable trigger check_message_report;
set role authenticated;
select pg_temp.as_user('b1000000-0000-0000-0000-00000000000b');
do $$ begin assert public.send_message(gen_random_uuid(), 'a1000000-0000-0000-0000-00000000000a', 'x')->>'status' = 'restricted', 'restricted cannot message'; end $$;
reset role;
