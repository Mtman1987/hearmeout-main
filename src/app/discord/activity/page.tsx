import DiscordActivityShell from "@/components/discord/DiscordActivityShell";

type SearchParamValue = string | string[] | undefined;

// In Next.js 15+ server components receive `searchParams` as a Promise.
// Awaiting it here ensures DiscordActivityShell sees real values like
// roomId/path; previously the raw Promise was passed through and every
// `searchParams.foo` lookup resolved to undefined, so targetHref always
// fell back to "/".
interface DiscordActivityPageProps {
  searchParams?: Promise<Record<string, SearchParamValue>>;
}

export default async function DiscordActivityPage({ searchParams }: DiscordActivityPageProps) {
  const resolved = (await searchParams) ?? {};
  return <DiscordActivityShell searchParams={resolved} />;
}