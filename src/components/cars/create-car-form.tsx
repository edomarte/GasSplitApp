"use client";

import { useActionState } from "react";

import { createCar, type CarFormState } from "@/app/cars/actions";
import { FieldError, FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateCarForm() {
  const [state, formAction] = useActionState<CarFormState, FormData>(createCar, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage error={state.error} />

      <div className="space-y-2">
        <Label htmlFor="name">Car name</Label>
        <Input id="name" name="name" placeholder="The Panda" maxLength={60} required />
        <FieldError message={state.fieldErrors?.name} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="odometer">Current odometer reading</Label>
        <Input
          id="odometer"
          name="odometer"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          placeholder="e.g. 92450"
          defaultValue=""
        />
        <FieldError message={state.fieldErrors?.odometer} />
        <p className="text-xs text-muted-foreground">
          In whole kilometres. The first trip you log will start from here.
        </p>
      </div>

      <SubmitButton pendingLabel="Creating...">Create car</SubmitButton>
    </form>
  );
}
