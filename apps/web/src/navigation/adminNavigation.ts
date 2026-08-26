import {
  BarChart3,
  ClipboardList,
  Layers,
  Package,
  PackageCheck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export type AdminNavigationItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  matches: (pathname: string) => boolean;
};

export type AdminNavigationSection = {
  label: string;
  items: AdminNavigationItem[];
};

export const adminNavigation: AdminNavigationSection[] = [
  {
    label: "Operación",
    items: [
      {
        label: "Pedidos activos",
        to: "/orders",
        icon: ClipboardList,
        matches: (pathname) => pathname === "/orders",
      },
      {
        label: "Pedidos entregados",
        to: "/admin/pedidos-entregados",
        icon: PackageCheck,
        matches: (pathname) => pathname === "/admin/pedidos-entregados",
      },
    ],
  },
  {
    label: "Administración",
    items: [
      {
        label: "Productos",
        to: "/admin/pricing",
        icon: Package,
        matches: (pathname) => pathname === "/admin/pricing"
          || pathname.startsWith("/admin/products/")
          || pathname === "/admin/production-capacity",
      },
      {
        label: "Inventario",
        to: "/admin/inventory",
        icon: Warehouse,
        matches: (pathname) => pathname === "/admin/inventory",
      },
      {
        label: "Grupos de precios",
        to: "/admin/pricing-groups",
        icon: Layers,
        matches: (pathname) => pathname === "/admin/pricing-groups",
      },
      {
        label: "Personal",
        to: "/admin/branches",
        icon: Users,
        matches: (pathname) => pathname === "/admin/branches",
      },
    ],
  },
  {
    label: "Reportes",
    items: [
      {
        label: "Dashboard",
        to: "/admin/dashboard",
        icon: BarChart3,
        matches: (pathname) => pathname === "/admin/dashboard",
      },
    ],
  },
];

export function adminNavigationForRole(role: string | undefined) {
  return role === "ADMIN" ? adminNavigation : [];
}

export function isAdminNavigationItemActive(item: AdminNavigationItem, pathname: string) {
  return item.matches(pathname);
}
