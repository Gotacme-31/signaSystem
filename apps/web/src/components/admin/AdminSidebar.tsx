import { LogOut, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { adminNavigationForRole, isAdminNavigationItemActive } from "../../navigation/adminNavigation";

type AdminSidebarProps = {
  role: string | undefined;
  userName: string;
  onLogout: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
  closeButtonRef?: React.RefObject<HTMLButtonElement | null>;
};

export default function AdminSidebar({
  role,
  userName,
  onLogout,
  onNavigate,
  onClose,
  closeButtonRef,
}: AdminSidebarProps) {
  const location = useLocation();
  const sections = adminNavigationForRole(role);

  return (
    <div className="flex h-full flex-col border-r border-default bg-brand-soft/30 text-primary">
      <div className="flex h-20 items-center justify-between border-b border-default bg-surface/80 px-5">
        <Link
          to="/orders"
          onClick={onNavigate}
          className="rounded-control text-xl font-black tracking-[0.2em] text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          SIGNA
        </Link>
        {onClose && (
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar navegación"
            className="rounded-control p-2 text-muted transition hover:bg-brand-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav aria-label="Navegación administrativa" className="flex-1 overflow-y-auto px-3 py-5">
        {sections.map((section) => (
          <section key={section.label} className="mb-6">
            <h2 className="px-3 text-[0.68rem] font-bold uppercase tracking-[0.2em] text-muted">
              {section.label}
            </h2>
            <div className="mt-2 space-y-1">
              {section.items.map((item) => {
                const active = isAdminNavigationItemActive(item, location.pathname);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-3 rounded-control border px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                      active
                        ? "border-default bg-surface text-brand shadow-surface"
                        : "border-transparent text-secondary hover:bg-brand-soft hover:text-primary"
                    }`}
                  >
                    {active && (
                      <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand" />
                    )}
                    <Icon className={`h-5 w-5 shrink-0 ${active ? "text-brand" : "text-muted"}`} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="border-t border-default bg-surface/70 p-4">
        <div className="mb-3 min-w-0 px-2">
          <p className="truncate text-sm font-bold text-primary">{userName}</p>
          <p className="mt-0.5 text-xs font-medium text-muted">Administrador</p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-sm font-semibold text-danger transition hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <LogOut className="h-5 w-5" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
