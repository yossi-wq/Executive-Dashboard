export default function Toast({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span className="toast-dot" />
          {t.message}
        </div>
      ))}
    </div>
  );
}
