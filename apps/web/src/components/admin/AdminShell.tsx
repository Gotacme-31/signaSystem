import { useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import AdminSidebar from "./AdminSidebar";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  function closeDrawer(restoreFocus = true) {
    setDrawerOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  function openDrawer() {
    setDrawerOpen(true);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    function closeAtDesktop(event: MediaQueryListEvent) {
      if (event.matches) setDrawerOpen(false);
    }
    desktopQuery.addEventListener("change", closeAtDesktop);
    return () => desktopQuery.removeEventListener("change", closeAtDesktop);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 lg:block">
        <AdminSidebar role={user?.role} userName={user?.name ?? "Administrador"} onLogout={handleLogout} />
      </aside>

      <div className="min-w-0 flex-1" inert={drawerOpen ? true : undefined}>
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:hidden">
          <span className="font-black tracking-[0.2em] text-slate-950">SIGNA</span>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={openDrawer}
            aria-label="Abrir navegación"
            aria-expanded={drawerOpen}
            aria-controls="admin-mobile-navigation"
            className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-50"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>

        <main className="min-w-0">{children}</main>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar navegación"
            onClick={() => closeDrawer()}
            tabIndex={-1}
            className="absolute inset-0 bg-slate-950/60"
          />
          <aside
            id="admin-mobile-navigation"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menú administrativo"
            className="relative h-dvh w-[min(21rem,88vw)] shadow-2xl"
          >
            <AdminSidebar
              role={user?.role}
              userName={user?.name ?? "Administrador"}
              onLogout={handleLogout}
              onNavigate={() => closeDrawer()}
              onClose={() => closeDrawer()}
              closeButtonRef={closeButtonRef}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
