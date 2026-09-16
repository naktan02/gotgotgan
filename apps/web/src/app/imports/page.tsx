import { redirect } from 'next/navigation'

export default function ImportsPage() {
  redirect('/settings?tab=import')
}
