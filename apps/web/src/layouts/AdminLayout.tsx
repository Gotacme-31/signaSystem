import { Outlet } from "react-router-dom";
import AdminShell from "../components/admin/AdminShell";

export default function AdminLayout() {
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
