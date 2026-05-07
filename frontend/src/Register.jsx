import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { API_BASE } from './config';
import './App.css';

export default function Register() {
  const [formData, setFormData] = useState({
    name: '', phone: '', password: '', address: '', sector: ''
  });
  const [error, setError] = useState(null);
  const [sectorsData, setSectorsData] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Usamos el endpoint público (no requiere login, necesario para el registro)
    axios.get(`${API_BASE}/api/sectors/public`).then(res => {
      setSectorsData(res.data);
      if (res.data.length > 0) {
        setFormData(prev => ({ ...prev, sector: res.data[0].name }));
      }
    }).catch(() => console.log("Error cargando sectores"));
  }, []);

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_BASE}/api/register`, formData);
      localStorage.setItem('alarma_token', res.data.token);
      localStorage.setItem('alarma_role', res.data.role);
      localStorage.setItem('alarma_name', res.data.name);
      navigate('/alarma');
    } catch (err) {
      setError(err.response?.data?.error || "Error de conexión");
    }
  };

  return (
    <div className="container" style={{ justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <UserPlus size={80} color="var(--medical)" />
        <h1 style={{ marginTop: '1rem' }}>UNIRSE COMO VECINO</h1>
      </div>
      
      <form onSubmit={handleRegister} className="grid" style={{ gridTemplateColumns: '1fr', gap: '1rem', background: 'var(--card)', padding: '2rem', borderRadius: '1rem', boxSizing: 'border-box' }}>
        {error && <div style={{ color: 'var(--danger)', textAlign: 'center', fontWeight: 'bold' }}>{error}</div>}
        
        <input type="text" placeholder="Tu Nombre Completo" required
            value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
            style={{ padding: '1rem', borderRadius: '0.5rem', border: '1px solid gray', background: 'var(--bg)', color: 'var(--text)' }} />
            
        <input type="text" placeholder="Teléfono" required
            value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
            style={{ padding: '1rem', borderRadius: '0.5rem', border: '1px solid gray', background: 'var(--bg)', color: 'var(--text)' }} />
            
        <input type="password" placeholder="Crear Contraseña" required
            value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
            style={{ padding: '1rem', borderRadius: '0.5rem', border: '1px solid gray', background: 'var(--bg)', color: 'var(--text)' }} />
            
        <input type="text" placeholder="Dirección / Casa" required
            value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})}
            style={{ padding: '1rem', borderRadius: '0.5rem', border: '1px solid gray', background: 'var(--bg)', color: 'var(--text)' }} />
            
        <select required value={formData.sector} onChange={e => setFormData({...formData, sector: e.target.value})}
            style={{ padding: '1rem', borderRadius: '0.5rem', border: '1px solid gray', background: 'var(--bg)', color: 'var(--text)' }}>
            {sectorsData.length === 0 ? (
                <option value="">(No hay sectores configurados en el servidor)</option>
            ) : (
                sectorsData.map(s => <option key={s.name} value={s.name}>{s.name}</option>)
            )}
        </select>

        <button type="submit" style={{ padding: '1rem', borderRadius: '0.5rem', background: 'var(--medical)', color: 'white', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginTop: '1rem', fontSize: '1.2rem' }}>
          CREAR CUENTA
        </button>
        
        <Link to="/" style={{ color: 'var(--text)', textAlign: 'center', marginTop: '1rem', textDecoration: 'none' }}>
           ¿Ya tienes cuenta? Ingresar
        </Link>
      </form>
    </div>
  );
}
