"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";

import { saveTrip, type TripFormState } from "@/app/cars/trip-actions";
import { FieldError, FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CarMember } from "@/lib/cars";
import { formatKm } from "@/lib/format";
import type { Trip } from "@/lib/trips";

type Props = {
  carId: string;
  members: CarMember[];
  /** Prefilled start reading: the highest end reading recorded so far. */
  lastOdometerKm: number;
  /** Present when editing rather than adding. */
  trip?: Trip;
  trigger: React.ReactNode;
};

type Proposed = NonNullable<TripFormState["proposed"]>;

export function TripDialog({ carId, members, lastOdometerKm, trip, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proposed, setProposed] = useState<Proposed | null>(null);

  // Closing happens here rather than in an effect watching the result: an
  // effect would re-run on every render that touches the state and fight the
  // user if they reopened the dialog straight away.
  const [state, formAction] = useActionState<TripFormState, FormData>(
    async (previous, formData) => {
      const result = await saveTrip(previous, formData);
      if (result.savedAt) setOpen(false);
      if (result.proposed) setProposed(result.proposed);
      return result;
    },
    {},
  );

  // A request is not a trip, so the dialog stays open and says what happened.
  // The page is refreshed on dismissal rather than by the action, or the
  // refresh would remount this and throw the result away.
  const close = () => {
    setOpen(false);
    if (proposed) {
      setProposed(null);
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {proposed ? (
          <Asked proposed={proposed} onClose={close} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{trip ? "Edit trip" : "Add a trip"}</DialogTitle>
              <DialogDescription>
                {trip
                  ? "Only trips that have not been settled can be changed."
                  : "Odometer readings in whole kilometres."}
              </DialogDescription>
            </DialogHeader>

            <TripForm
              key={open ? "open" : "closed"}
              carId={carId}
              members={members}
              lastOdometerKm={lastOdometerKm}
              trip={trip}
              state={state}
              formAction={formAction}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What happened after asking. Nothing has been recorded yet, and it says so. */
function Asked({ proposed, onClose }: { proposed: Proposed; onClose: () => void }) {
  const names = proposed.asked.map((person) => person.displayName);
  const undelivered = proposed.asked.filter((person) => person.status !== "sent");

  return (
    <>
      <DialogHeader>
        <DialogTitle>Asked {listNames(names)}</DialogTitle>
        <DialogDescription>
          {formatKm(proposed.distanceKm)}
          {proposed.ways > 1 ? (
            <> split {proposed.ways} ways — {formatKm(proposed.distanceKm / proposed.ways)} each</>
          ) : null}
          .
        </DialogDescription>
      </DialogHeader>

      <p className="text-sm text-muted-foreground">
        Nothing has been recorded yet. The trip appears, and the kilometres count, once{" "}
        {proposed.asked.length === 1 ? "they confirm" : "they all confirm"} it. Until then the car
        cannot be settled.
      </p>

      {undelivered.length > 0 ? (
        <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Not emailed</p>
          <ul className="mt-1 space-y-0.5">
            {undelivered.map((person) => (
              <li key={person.displayName}>
                {person.displayName} —{" "}
                {person.status === "skipped" ? "email is not set up" : person.detail}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            The request is still waiting for them in the app; only the message failed.
          </p>
        </div>
      ) : null}

      <Button onClick={onClose} className="w-full">
        Done
      </Button>
    </>
  );
}

function TripForm({
  carId,
  members,
  lastOdometerKm,
  trip,
  state,
  formAction,
}: Omit<Props, "trigger"> & {
  state: TripFormState;
  formAction: (formData: FormData) => void;
}) {
  const ids = useId();
  const me = members.find((member) => member.isYou);
  const others = members.filter((member) => !member.isYou);

  const [startKm, setStartKm] = useState(String(trip?.startKm ?? lastOdometerKm));
  const [endKm, setEndKm] = useState(trip ? String(trip.endKm) : "");

  // Who was actually at the wheel. Anyone but you turns this into a request.
  const [driverId, setDriverId] = useState(me?.userId ?? "");
  const [isShared, setIsShared] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  // Someone who took part and has since left. They stay on the trip — the drive
  // happened — but there is no checkbox to un-tick, because re-adding them
  // later would not be allowed.
  const departed = trip
    ? trip.participants.filter(
        (person) => !person.isYou && !members.some((member) => member.userId === person.userId),
      )
    : [];

  const start = Number(startKm);
  const end = Number(endKm);
  const distance = Number.isFinite(start) && Number.isFinite(end) ? end - start : 0;

  // Everyone on the drive, when adding. The driver is always on it.
  const people = trip ? [] : [driverId, ...(isShared ? selected : [])].filter(Boolean);
  const strangers = people.filter((id) => id !== me?.userId);
  const willAsk = strangers.length > 0;
  const ways = trip ? trip.participants.length : Math.max(people.length, 1);

  const nameOf = (id: string) => members.find((member) => member.userId === id)?.displayName ?? "";

  // Warn, do not block: people forget to log a trip, and the next one then
  // legitimately starts above the last recorded reading. Starting *below* it is
  // the suspicious case, and still allowed.
  //
  // Only when adding. The highest recorded reading already includes the trip
  // being edited, so on an edit this would fire every single time and teach
  // people to ignore it.
  const startsBelowLast = !trip && Number.isFinite(start) && start < lastOdometerKm;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="carId" value={carId} />
      <input type="hidden" name="tripId" value={trip?.id ?? ""} />
      {people.map((id) => (
        <input key={id} type="hidden" name="people" value={id} />
      ))}

      <FormMessage error={state.error} />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`${ids}-start`}>Start</Label>
          <Input
            id={`${ids}-start`}
            name="startKm"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={startKm}
            onChange={(event) => setStartKm(event.target.value)}
            required
          />
          <FieldError message={state.fieldErrors?.startKm} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${ids}-end`}>End</Label>
          <Input
            id={`${ids}-end`}
            name="endKm"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={endKm}
            onChange={(event) => setEndKm(event.target.value)}
            // No placeholder. A number here reads as a suggestion, and the one
            // figure the app must not put in anyone's head is what the odometer
            // ought to say — it is the number the whole split is derived from.
            required
          />
          <FieldError message={state.fieldErrors?.endKm} />
        </div>
      </div>

      {startsBelowLast ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          The last reading recorded was {formatKm(lastOdometerKm)}. Starting below it is
          allowed — someone may have forgotten to log a trip — but check it is right.
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {distance > 0 ? (
          <>
            <span className="font-medium text-foreground">{formatKm(distance)}</span>
            {ways > 1 ? (
              <> split {ways} ways — {formatKm(distance / ways)} each</>
            ) : null}
          </>
        ) : (
          "Enter both readings to see the distance."
        )}
      </p>

      <div className="space-y-2">
        <Label htmlFor={`${ids}-date`}>Date</Label>
        <Input
          id={`${ids}-date`}
          name="drivenOn"
          type="date"
          defaultValue={trip?.drivenOn ?? today()}
          max={today(1)}
          required
        />
        <FieldError message={state.fieldErrors?.drivenOn} />
      </div>

      {trip ? (
        <EditingParticipants trip={trip} departed={departed} />
      ) : others.length > 0 ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-2">
            <Label htmlFor={`${ids}-driver`}>Who drove?</Label>
            <select
              id={`${ids}-driver`}
              value={driverId}
              onChange={(event) => {
                const next = event.target.value;
                setDriverId(next);
                setSelected((current) => current.filter((id) => id !== next));
              }}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {me ? <option value={me.userId}>Me</option> : null}
              {others.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${ids}-shared`} className="cursor-pointer">
              Shared with someone
            </Label>
            <Switch
              id={`${ids}-shared`}
              checked={isShared}
              onCheckedChange={(checked) => {
                setIsShared(checked);
                if (!checked) setSelected([]);
              }}
            />
          </div>

          {isShared ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Shared equally between {driverId === me?.userId ? "you" : nameOf(driverId)} and
                everyone you pick.
              </p>
              {members
                .filter((member) => member.userId !== driverId)
                .map((member) => (
                  <label
                    key={member.userId}
                    className="flex cursor-pointer items-center gap-3 text-sm"
                  >
                    <Checkbox
                      checked={selected.includes(member.userId)}
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked
                            ? [...current, member.userId]
                            : current.filter((id) => id !== member.userId),
                        )
                      }
                    />
                    {member.isYou ? "Me" : member.displayName}
                  </label>
                ))}
              {selected.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nobody picked yet — it will be recorded as{" "}
                  {driverId === me?.userId ? "yours alone" : `${nameOf(driverId)}'s alone`}.
                </p>
              ) : null}
            </div>
          ) : null}

          {willAsk ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {listNames(strangers.map(nameOf))}{" "}
              {strangers.length === 1 ? "has" : "have"} to confirm this before it is recorded.
              Nothing is charged to {strangers.length === 1 ? "them" : "anyone"} until{" "}
              {strangers.length === 1 ? "they do" : "they all do"}, and the car cannot be settled
              while it is waiting.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={`${ids}-note`}>Note (optional)</Label>
        <Input
          id={`${ids}-note`}
          name="note"
          maxLength={200}
          defaultValue={trip?.note ?? ""}
          placeholder="Airport run"
        />
      </div>

      <SubmitButton pendingLabel={willAsk ? "Asking..." : "Saving..."}>
        {trip
          ? "Save changes"
          : willAsk
            ? `Ask ${listNames(strangers.map(nameOf))} to confirm`
            : "Save trip"}
      </SubmitButton>
    </form>
  );
}

/**
 * Editing never changes who was on a drive.
 *
 * A trip everyone confirmed cannot be edited at all, and one recorded before
 * confirmations existed keeps whoever is on it — adding somebody by editing
 * would be the same charge-without-asking the request flow exists to prevent.
 */
function EditingParticipants({
  trip,
  departed,
}: {
  trip: Trip;
  departed: Trip["participants"];
}) {
  if (trip.participants.length <= 1) return null;

  const names = trip.participants.map((person) => (person.isYou ? "you" : person.displayName));

  return (
    <div className="space-y-2 rounded-lg border p-3">
      {trip.participants.map((person) => (
        <input key={person.userId} type="hidden" name="participants" value={person.userId} />
      ))}
      <p className="text-xs text-muted-foreground">
        Shared between {listNames(names)} — {formatKm(trip.sharePerPerson)} each. Who was on a
        drive cannot be changed by editing it.
        {departed.length > 0 ? (
          <>
            {" "}
            {listNames(departed.map((person) => person.displayName))}{" "}
            {departed.length === 1 ? "has" : "have"} since left the car, and{" "}
            {departed.length === 1 ? "their share stays" : "their shares stay"} on the trip.
          </>
        ) : null}
      </p>
    </div>
  );
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Today in the viewer's own timezone, as the date input expects it. */
function today(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
