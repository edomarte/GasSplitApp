import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { CreateCarForm } from "@/components/cars/create-car-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/dal";

export const metadata: Metadata = { title: "Add a car" };

export default async function NewCarPage() {
  const user = await requireUser();

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Back
        </Link>
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Add a car</CardTitle>
            <CardDescription>
              You will be its owner, and can invite the others afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateCarForm />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
