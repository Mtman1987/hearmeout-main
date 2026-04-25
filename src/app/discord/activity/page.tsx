import DiscordActivityShell from "@/components/discord/DiscordActivityShell";

type SearchParamValue = string | string[] | undefined;

interface DiscordActivityPageProps {
  searchParams?: Record<string, SearchParamValue>;
}

export function DiscordActivityPage({ searchParams }: DiscordActivityPageProps) {
  return <DiscordActivityShell searchParams={searchParams ?? {}} />;
}

export default DiscordActivityPage;