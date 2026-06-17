import { getNotifications } from '@/app/actions/notifications'
import { InboxClient } from './InboxClient'

export default async function InboxPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { items } = await getNotifications(orgSlug, 60)
  return <InboxClient orgSlug={orgSlug} initial={items} />
}
