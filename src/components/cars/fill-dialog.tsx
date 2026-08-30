"use client";

import { useRouter } from "next/navigation";
import { useActionState, useId, useState } from "react";

import { recordFill, type FillFormState } from "@/app/cars/fill-actions";
import { FieldError, FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
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
import { apportionAmong } from "@/lib/apportion";
import { formatKm, formatMoney } from "@/lib/format";
import { parseMoneyToCents } from "@/lib/money";
import type { OpenPeriod } from "@/lib/trips";

type Props = {
  carId: string;
  currency: string;
  period: OpenPeriod;
  lastOdometerKm: number;
  trigger: React.ReactNode;
};

export function FillDialog({ carId, currency, period, lastOdometerKm, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<FillFormState, FormData>(recordFill, {});

  // The page is refreshed on dismissal rather than by the action, so the
  // settlement result stays on screen until it has been read.
  const close = () => {
    setOpen(false);
    if (state.settled) router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {state.settled ? (
          <Settled settled={state.settled} currency={currency} onClose={close} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Record a fuel fill</DialogTitle>
              <DialogDescription>
                This closes the current period and tells everyone what they owe you.
              </DialogDescription>
            </DialogHeader>
            <FillForm
              key={open ? "open" : "closed"}
              carId={carId}
              currency={currency}
              period={period}
              lastOdometerKm={lastOdometerKm}
              state={state}
              formAction={formAction}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FillForm({
  carId,
  currency,
  period,
  lastOdometerKm,
  state,
  formAction,
}: Omit<Props, "trigger"> & {
  state: FillFormState;
  formAction: (formData: FormData) => void;
}) {
  const ids = useId();
  const [cost, setCost] = useState("");

  const cents = parseMoneyToCents(cost);
  const drivers = period.perMember.filter((member) => member.km > 0);

  // The same largest-remainder split the database will perform. It is a
  // preview, not the record: the amounts people are charged are read back from
  // what was actually written down.
  const preview =
    cents !== null && cents > 0 && drivers.length > 0
      ? apportionAmong(cents, drivers, (member) => member.km)
      : null;

  if (period.totalKm === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nobody has logged a trip since the last fill, so there is nothing to split yet.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="carId" value={carId} />

      <FormMessage error={state.error} />

      <div className="space-y-2">
        <Label htmlFor={`${ids}-cost`}>What it cost</Label>
        <Input
          id={`${ids}-cost`}
          name="cost"
          inputMode="decimal"
          placeholder="72.40"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
          required
        />
        <FieldError message={state.fieldErrors?.cost} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${ids}-date`}>Date</Label>
        <Input id={`${ids}-date`} name="filledOn" type="date" defaultValue={today()} max={today(1)} required />
        <FieldError message={state.fieldErrors?.filledOn} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${ids}-odometer`}>Odometer (optional)</Label>
        <Input
          id={`${ids}-odometer`}
          name="odometer"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          placeholder={String(lastOdometerKm)}
        />
        <FieldError message={state.fieldErrors?.odometer} />
      </div>

      <div className="rounded-lg border p-3">
        <p className="text-sm font-medium">
          {formatKm(period.displayTotalKm)} since the last fill
        </p>
        {preview ? (
          <ul className="mt-2 space-y-1.5">
            {preview.map(({ item, units }) => (
              <li key={item.userId} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {item.displayName}
                  {item.isYou ? <span className="text-muted-foreground"> (you)</span> : null}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {formatKm(item.displayKm)}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatMoney(units, currency)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Enter the cost to see what each person owes.
          </p>
        )}
      </div>

      <SubmitButton pendingLabel="Recording...">
        {preview ? `Record ${formatMoney(parseMoneyToCents(cost) ?? 0, currency)} fill` : "Record fill"}
      </SubmitButton>
      <p className="text-center text-xs text-muted-foreground">
        The trips are kept, but can no longer be edited.
      </p>
    </form>
  );
}

function Settled({
  settled,
  currency,
  onClose,
}: {
  settled: NonNullable<FillFormState["settled"]>;
  currency: string;
  onClose: () => void;
}) {
  const failed = settled.notifications.filter((row) => row.status !== "sent");

  return (
    <>
      <DialogHeader>
        <DialogTitle>Fill recorded</DialogTitle>
        <DialogDescription>
          {formatMoney(settled.totalCents, currency)} split across the period.
        </DialogDescription>
      </DialogHeader>

      <ul className="space-y-1.5">
        {settled.shares.map((share) => (
          <li
            key={share.displayName}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="min-w-0 truncate">
              {share.displayName}
              {share.isYou ? <span className="text-muted-foreground"> (you)</span> : null}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatMoney(share.amountCents, currency)}
            </span>
          </li>
        ))}
      </ul>

      {failed.length > 0 ? (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="font-medium">Some notifications did not go out.</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {failed.map((row) => (
              <li key={row.displayName}>
                {row.displayName}
                {row.email ? ` (${row.email})` : ""} —{" "}
                {row.status === "skipped" ? "email is not set up" : (row.detail ?? "failed")}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">
            The split above is recorded either way. Tell them yourself for now.
          </p>
        </div>
      ) : (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Everyone has been emailed their share.
        </p>
      )}

      <Button onClick={onClose} className="w-full">
        Done
      </Button>
    </>
  );
}

/** Today in the viewer's own timezone, as the date input expects it. */
function today(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
