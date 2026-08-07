import { redirect } from 'next/navigation'

/**
 * Setup used to live here, on its own page. It now lives on the client page
 * itself, because a client's configuration reading as ONE coherent status was
 * the point — splitting the interview from the settings it writes is what let
 * the two disagree in the first place.
 *
 * This stays as a redirect rather than being deleted. StartOnboardingButton,
 * revalidatePath calls in app/actions/onboarding.ts, and any link an admin has
 * bookmarked or pasted into Slack all still point here; deleting the route would
 * turn every one of those into a 404 for no benefit.
 */
export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/clients/${id}`)
}
