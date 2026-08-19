export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-slate-800">No site assigned</h1>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Your account is active but not assigned to any site yet. Ask the owner to add you to a
          site from the dashboard.
        </p>
      </div>
    </main>
  );
}
