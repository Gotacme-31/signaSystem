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
    <div className="flex h-full flex-col bg-slate-950 text-white">
      <div className="flex h-20 items-center justify-between border-b border-white/10 px-5">
        <Link to="/orders" onClick={onNavigate} className="text-xl font-black tracking-[0.2em] text-white">
          SIGNA
        </Link>
        {onClose && (
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar navegación"
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav aria-label="Navegación administrativa" className="flex-1 overflow-y-auto px-3 py-5">
        {sections.map((section) => (
          <section key={section.label} className="mb-6">
            <h2 className="px-3 text-[0.68rem] font-bold uppercase tracking-[0.2em] text-slate-500">
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
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                      active
                        ? "bg-indigo-500 text-white shadow-lg shadow-indigo-950/30"
                        : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="mb-3 min-w-0 px-2">
          <p className="truncate text-sm font-bold text-white">{userName}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-400">Administrador</p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-500/15 hover:text-red-100"
        >
          <LogOut className="h-5 w-5" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
