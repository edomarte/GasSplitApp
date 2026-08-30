import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { CarMember } from "@/lib/cars";

/** Two letters is enough to tell members apart at a glance. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function MemberAvatar({
  member,
  className,
}: {
  member: Pick<CarMember, "displayName" | "avatarUrl">;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      {member.avatarUrl ? (
        <AvatarImage src={member.avatarUrl} alt="" />
      ) : null}
      <AvatarFallback className="text-xs">{initials(member.displayName)}</AvatarFallback>
    </Avatar>
  );
}
