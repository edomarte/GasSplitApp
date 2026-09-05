import { deleteTrip } from "@/app/cars/trip-actions";
import { TripDialog } from "@/components/cars/trip-dialog";
import { Button } from "@/components/ui/button";
import type { CarMember } from "@/lib/cars";
import { formatDay, formatKm } from "@/lib/format";
import type { Trip } from "@/lib/trips";

export function TripList({
  carId,
  trips,
  members,
  lastOdometerKm,
}: {
  carId: string;
  trips: Trip[];
  members: CarMember[];
  lastOdometerKm: number;
}) {
  if (trips.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing logged yet since the last fill.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {trips.map((trip) => (
        <li key={trip.id} className="flex items-start gap-3 py-3 first:pt-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {formatKm(trip.distanceKm)}
              <span className="ml-2 font-normal text-muted-foreground">
                {formatKm(trip.startKm)} → {formatKm(trip.endKm)}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatDay(trip.drivenOn)} · {describeParticipants(trip)}
            </p>
            {trip.note ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{trip.note}</p>
            ) : null}
          </div>

          {trip.isYours ? (
            <div className="flex shrink-0 items-center">
              {/* A trip everyone confirmed is frozen: editing it would change
                  what they agreed to. Deleting only ever takes kilometres
                  away, so that stays. */}
              {trip.fromProposal ? null : (
                <TripDialog
                  carId={carId}
                  members={members}
                  lastOdometerKm={lastOdometerKm}
                  trip={trip}
                  trigger={
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  }
                />
              )}
              <form action={deleteTrip}>
                <input type="hidden" name="tripId" value={trip.id} />
                <input type="hidden" name="carId" value={carId} />
                <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                  Delete
                </Button>
              </form>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** "Alice alone" or "split with Bob — 50 km each". */
function describeParticipants(trip: Trip): string {
  // Whoever drove, which is not always whoever wrote it down: a trip recorded
  // for somebody else has one participant, and it is not the recorder.
  if (trip.participants.length === 1) {
    const driver = trip.participants[0];
    return driver.isYou ? "Yours" : driver.displayName;
  }
  if (trip.participants.length === 0) {
    return trip.isYours ? "Yours" : trip.recordedByName;
  }

  const names = trip.participants.map((p) => (p.isYou ? "you" : p.displayName));
  return `Split between ${listNames(names)} — ${formatKm(trip.sharePerPerson)} each`;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
