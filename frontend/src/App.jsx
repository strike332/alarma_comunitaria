import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import Register from './Register';
import AdminPanel from './AdminPanel';
import AlarmaPanel from './AlarmaPanel';
import EmergencyView from './EmergencyView';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/emergencia" element={<EmergencyView />} />
        <Route path="/alarma" element={
          <ProtectedRoute>
            <AlarmaPanel />
          </ProtectedRoute>
        } />
        <Route path="/admin" element={
          <ProtectedRoute requiredRole="admin">
            <AdminPanel />
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}

// Componente para proteger mirones
function ProtectedRoute({ children, requiredRole }) {
  const token = localStorage.getItem('alarma_token');
  const role = localStorage.getItem('alarma_role');

  if (!token) {
    return <Navigate to="/" />;
  }

  if (requiredRole && role !== requiredRole) {
    return <Navigate to="/alarma" />;
  }

  return children;
}
