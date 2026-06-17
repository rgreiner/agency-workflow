-- Permite o usuário apagar as próprias notificações. Idempotente.

drop policy if exists "notif own delete" on notifications;
create policy "notif own delete" on notifications for delete using (user_id = auth.uid());

grant delete on notifications to anon, authenticated;

notify pgrst, 'reload schema';
