export function Stub({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold text-navy">{title}</h1>
      <div className="card">
        <p className="text-textSecondary">
          Coming in <span className="font-medium text-navy">{phase}</span>.
        </p>
      </div>
    </div>
  );
}
