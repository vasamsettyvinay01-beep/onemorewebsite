export function DisabledPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-lg">
      <p className="text-[0.65rem] font-medium uppercase tracking-[0.16em] text-white/40">Disabled</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-white/60">{body}</p>
    </div>
  );
}
