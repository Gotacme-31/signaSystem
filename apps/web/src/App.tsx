import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import Login from "./pages/Login";
import Products from "./pages/Products";
import AdminPricing from "./pages/AdminPricing";
import type { JSX } from "react";
import RegisterCustomer from "./pages/RegisterCustomer";
import NewOrder from "./pages/NewOrder";


function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 20 }}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function ProtectedAdmin({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 20 }}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "ADMIN") return <Navigate to="/products" replace />;
  return children;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 20 }}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "ADMIN" ? "/admin/pricing" : "/products"} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/products"
          element={
            <Protected>
              <Products />
            </Protected>
          }
        />

        <Route
          path="/admin/pricing"
          element={
            <ProtectedAdmin>
              <AdminPricing />
            </ProtectedAdmin>
          }
        />
        <Route path="/register" element={<RegisterCustomer />} />
        <Route
          path="/orders/new"
          element={
            <Protected>
              <NewOrder />
            </Protected>
          }
        />
        {/* Cualquier otra ruta manda al “home” según rol */}
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
