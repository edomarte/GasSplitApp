"use client";

import { useActionState, useId, useState } from "react";

import { saveTrip, type TripFormState } from "@/app/cars/trip-actions";
import { FieldError, FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
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

export function TripDialog({ carId, members, lastOdometerKm, trip, trigger }: Props) {
  const [open, setOpen] = useState(false);

  // Closing happens here rather than in an effect watching the result: an
  // effect would re-run on every render that touches the state and fight the
  // user if they reopened the dialog straight away.
  const [state, formAction] = useActionState<TripFormState, FormData>(
    async (previous, formData) => {
      const result = await saveTrip(previous, formData);
      if (result.savedAt) setOpen(false);
      return result;
    },
    {},
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
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
      </DialogContent>
    </Dialog>
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
  const others = members.filter((m) => !m.isYou);

  const [startKm, setStartKm] = useState(String(trip?.startKm ?? lastOdometerKm));
  const [endKm, setEndKm] = useState(trip ? String(trip.endKm) : "");
  const [isSplit, setIsSplit] = useState(
    trip ? trip.participants.length > 1 : false,
  );

  // Someone who took part and has since left. They stay on the trip — the drive
  // happened — but there is no checkbox to un-tick, because re-adding them
  // later would not be allowed.
  const departed = trip
    ? trip.participants.filter(
        (p) => !p.isYou && !members.some((m) => m.userId === p.userId),
      )
    : [];

  const [selected, setSelected] = useState<string[]>(
    trip
      ? trip.participants
          .filter((p) => !p.isYou && members.some((m) => m.userId === p.userId))
          .map((p) => p.userId)
      : [],
  );

  const start = Number(startKm);
  const end = Number(endKm);
  const distance = Number.isFinite(start) && Number.isFinite(end) ? end - start : 0;
  const splitCount = (isSplit ? selected.length : 0) + departed.length + 1;

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
            placeholder={String(lastOdometerKm + 20)}
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
            {splitCount > 1 ? (
              <> split {splitCount} ways — {formatKm(distance / splitCount)} each</>
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

      {departed.map((person) => (
        <input key={person.userId} type="hidden" name="participants" value={person.userId} />
      ))}

      {departed.length > 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {listNames(departed.map((p) => p.displayName))}{" "}
          {departed.length === 1 ? "was" : "were"} on this drive and{" "}
          {departed.length === 1 ? "has" : "have"} since left the car.{" "}
          {departed.length === 1 ? "Their" : "Their"} share stays on the trip.
        </p>
      ) : null}

      {others.length > 0 ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${ids}-split`} className="cursor-pointer">
              Split this drive
            </Label>
            <Switch
              id={`${ids}-split`}
              checked={isSplit}
              onCheckedChange={(checked) => {
                setIsSplit(checked);
                if (!checked) setSelected([]);
              }}
            />
          </div>

          {isSplit ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Shared equally between you and everyone you pick.
              </p>
              {others.map((member) => (
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
                  {member.displayName}
                </label>
              ))}
              {selected.map((id) => (
                <input key={id} type="hidden" name="participants" value={id} />
              ))}
              {selected.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nobody picked yet — it will be recorded as yours alone.
                </p>
              ) : null}
            </div>
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

      <SubmitButton pendingLabel="Saving...">{trip ? "Save changes" : "Save trip"}</SubmitButton>
    </form>
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
