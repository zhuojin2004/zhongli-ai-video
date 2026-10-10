import { Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { AuthProvider } from "@/contexts/AuthContext";
import { RoleProvider } from "@/contexts/RoleContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import NotFoundPage from "@/pages/NotFoundPage/NotFoundPage";
import MaterialLibraryPage from "@/pages/MaterialLibraryPage/MaterialLibraryPage";
import MaterialUploadPage from "@/pages/MaterialUploadPage/MaterialUploadPage";
import LoginPage from "@/pages/LoginPage/LoginPage";

export default function App() {
  return (
    <AuthProvider>
      <RoleProvider>
        <Routes>
          {/* 登录页：独立 layout，不强制登录 */}
          <Route path="/login" element={<LoginPage />} />

          {/* 业务路由：必须登录才能进 */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<MaterialLibraryPage />} />
            <Route path="materials" element={<MaterialLibraryPage />} />
            <Route path="upload" element={<MaterialUploadPage />} />
          </Route>

          {/* 兜底：未匹配的路径 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </RoleProvider>
    </AuthProvider>
  );
}