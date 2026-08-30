export function FormMessage({ error, notice }: { error?: string; notice?: string }) {
  if (!error && !notice) return null;

  return (
    <p
      role="status"
      className={
        error
          ? "rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          : "rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
      }
    >
      {error ?? notice}
    </p>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}
