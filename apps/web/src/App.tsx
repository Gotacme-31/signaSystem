import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import Login from "./pages/Login";
import Products from "./pages/Products";
import AdminPricing from "./pages/AdminPricing";
import type { JSX } from "react";
import RegisterCustomer from "./pages/RegisterCustomer";
import NewOrder from "./pages/NewOrder";
import ActiveOrders from "./pages/ActiveOrders";
import AdminProductEdit from "./pages/AdminProductEdit";
import DashboardPage from './pages/DashboardPage';
import AdminProductNew from "./pages/AdminProductNew";
import './index.css'; // Añade esta línea
import AdminBranches from "./pages/AdminBranches";


function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ padding: 20 }}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function ProtectedAdmin({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ padding: 20 }}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.role !== "ADMIN") return <Navigate to="/orders" replace />;
  return children;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 20 }}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "ADMIN" ? "/admin/pricing" : "/orders"} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/register" element={
          <Protected><RegisterCustomer /></Protected>} />

        <Route
          path="/orders/new"
          element={
            <Protected>
              <NewOrder />
            </Protected>
          }
        />

        <Route
          path="/orders"
          element={
            <Protected>
              <ActiveOrders />
            </Protected>
          }
        />
        <Route
          path="/admin/products/:id"
          element={
            <ProtectedAdmin>
              <AdminProductEdit />
            </ProtectedAdmin>
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
        <Route path="/admin/products/new" element={<ProtectedAdmin><AdminProductNew /></ProtectedAdmin>} />
        {/* Debug (lo borras después) */}
        <Route
          path="/products"
          element={
            <Protected>
              <Products />
            </Protected>
          }
        />

        <Route path="/admin/branches" element={<ProtectedAdmin><AdminBranches /></ProtectedAdmin>} />
        <Route path="/admin/dashboard" element={
          <ProtectedAdmin>
            <DashboardPage />
          </ProtectedAdmin>
        } />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
