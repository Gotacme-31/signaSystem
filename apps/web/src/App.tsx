import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Products from "./pages/Products";
import AdminPricing from "./pages/AdminPricing";
import RegisterCustomer from "./pages/RegisterCustomer";
import NewOrder from "./pages/NewOrder";
import ActiveOrders from "./pages/ActiveOrders";
import AdminProductEdit from "./pages/AdminProductEdit";
import DashboardPage from "./pages/DashboardPage";
import AdminProductNew from "./pages/AdminProductNew";
import AdminBranches from "./pages/AdminBranches";
import "./index.css";
import { SocketProvider } from "./contexts/SocketContext";
import { ErrorBoundary } from "./ErrorBoundary";
import { ProtectedRoute, ProtectedAdminRoute } from "./auth/ProtectedRoutes";
import { useAuth } from "./auth/useAuth";
import { AuthProvider } from "./auth/AuthContext";
import React from "react";

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 20 }}>Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "ADMIN" ? "/admin/pricing" : "/orders"} replace />;
}
export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <SocketProvider>
            <Routes>
              <Route path="/login" element={<Login />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/register" element={<RegisterCustomer />} />
                <Route path="/orders/new" element={<NewOrder />} />
                <Route path="/orders" element={<ActiveOrders />} />
                <Route path="/products" element={<Products />} />
              </Route>

              <Route element={<ProtectedAdminRoute />}>
                <Route path="/admin/products/new" element={<AdminProductNew />} />
                <Route path="/admin/products/:id" element={<AdminProductEdit />} />
                <Route path="/admin/pricing" element={<AdminPricing />} />
                <Route path="/admin/branches" element={<AdminBranches />} />
                <Route path="/admin/dashboard" element={<DashboardPage />} />
              </Route>

              <Route path="*" element={<HomeRedirect />} />
            </Routes>
          </SocketProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </AuthProvider>
  );
}