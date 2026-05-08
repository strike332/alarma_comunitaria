import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldAlert, CreditCard, Ticket, Loader } from 'lucide-react';
import { API_BASE } from './config';
import './App.css';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // Paywall state
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallPhone, setPaywallPhone] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoError, setPromoError] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [plans, setPlans] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('alarma_token');
    const role = localStorage.getItem('alarma_role');
    if (token) {
      if (role === 'admin') navigate('/admin');
      else navigate('/alarma');
    }
  }, [navigate]);

  const saveSessionAndNavigate = (data) => {
    localStorage.setItem('alarma_token', data.token);
    localStorage.setItem('alarma_role', data.role);
    localStorage.setItem('alarma_name', data.name);
    if (data.role === 'admin') navigate('/admin');
    else navigate('/alarma');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/api/login`, { phone, password });
      saveSessionAndNavigate(res.data);
    } catch (err) {
      if (err.response?.status === 402) {
        // Suscripción vencida o inactiva → mostrar Paywall
        setPaywallPhone(phone);
        setShowPaywall(true);
        fetchPlans();
      } else {
        setError(err.response?.data?.error || 'Error de conexión');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRedeemCode = async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const res = await axios.post(`${API_BASE}/api/promo/redeem-paywall`, {
        code: promoCode.trim().toUpperCase(),
        phone: paywallPhone
      });
      saveSessionAndNavigate(res.data);
    } catch (err) {
      setPromoError(err.response?.data?.error || 'Código inválido o ya utilizado.');
    } finally {
      setPromoLoading(false);
    }
  };

  const handlePay = async (planId) => {
    try {
      const res = await axios.post(`${API_BASE}/api/subscription/create-paywall`, { phone: paywallPhone, plan_id: planId });
      if (res.data.init_point) window.location.href = res.data.init_point;
    } catch (err) {
      setPromoError('Error al conectar con Mercado Pago. Intenta de nuevo.');
    }
  };

  // Fetch plans when paywall shows
  const fetchPlans = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/plans`);
      setPlans(Array.isArray(res.data) ? res.data : []);
    } catch {}
  };

  if (showPaywall) {
    return (
      <div className="container" style={{ justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <CreditCard size={80} color="var(--danger)" />
          <h1 style={{ marginTop: '1rem', fontSize: '1.6rem' }}>ACCESO RESTRINGIDO</h1>
          <p style={{ color: 'gray', marginTop: '0.5rem' }}>
            Tu cuenta no tiene una suscripción activa.<br/>
            Paga o ingresa un código de acceso para continuar.
          </p>
        </div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Planes disponibles */}
          {plans.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <h3 style={{ textAlign: 'center', marginBottom: '1rem' }}>Elige tu plan</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {plans.map(plan => (
                  <button
                    key={plan.id}
                    onClick={() => handlePay(plan.id)}
                    style={{ padding: '1rem', background: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: '0.75rem', cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{plan.name}</div>
                      {plan.description && <div style={{ color: 'gray', fontSize: '0.85rem' }}>{plan.description}</div>}
                      <div style={{ color: 'gray', fontSize: '0.8rem', marginTop: '0.25rem' }}>{plan.duration_days} días</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '1.2rem', color: 'var(--medical)' }}>${plan.price?.toLocaleString()}</span>
                      <CreditCard size={20} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Opción 1: Código */}
          <div style={{ background: 'var(--card)', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #334155' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Ticket size={22} color="var(--medical)" />
              <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>Tengo un Código de Acceso</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={promoCode}
                onChange={e => setPromoCode(e.target.value.toUpperCase())}
                placeholder="Ej: VEC-A3B2C1D0"
                style={{ flex: 1, padding: '0.9rem', borderRadius: '0.5rem', border: '1px solid #444', background: 'var(--bg)', color: 'var(--text)', fontSize: '1rem', fontFamily: 'monospace' }}
              />
              <button
                onClick={handleRedeemCode}
                disabled={promoLoading}
                style={{ padding: '0.9rem 1.5rem', background: 'var(--medical)', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {promoLoading ? <Loader size={18} className="spin" /> : 'CANJEAR'}
              </button>
            </div>
            {promoError && <p style={{ color: 'var(--danger)', marginTop: '0.5rem', fontWeight: 'bold', fontSize: '0.9rem' }}>{promoError}</p>}
          </div>

          {/* Opción 2: Pagar (si no hay planes) */}
          {plans.length === 0 && (
            <button
              onClick={() => handlePay(null)}
              style={{ padding: '1.2rem', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '1rem', fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              <CreditCard size={22} /> PAGAR SUSCRIPCIÓN
            </button>
          )}

          <button
            onClick={() => setShowPaywall(false)}
            style={{ background: 'transparent', border: 'none', color: 'gray', cursor: 'pointer', padding: '0.5rem', fontSize: '0.9rem' }}
          >
            ← Volver al inicio de sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <ShieldAlert size={80} color="var(--danger)" />
        <h1 style={{ marginTop: '1rem' }}>SISTEMA DE SEGURIDAD</h1>
      </div>
      
      <form onSubmit={handleLogin} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--card)', padding: '2rem', borderRadius: '1rem', boxSizing: 'border-box' }}>
        {error && <div style={{ color: 'var(--danger)', textAlign: 'center', fontWeight: 'bold' }}>{error}</div>}
        
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span>Teléfono:</span>
          <input 
            type="text" 
            value={phone} 
            onChange={e => setPhone(e.target.value)}
            style={{ padding: '1rem', borderRadius: '0.5rem', border: '1px solid gray', background: 'var(--bg)', color: 'var(--text)' }}
            placeholder="Ingrese su número"
            required
          />
        </label>
        
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span>Contraseña:</span>
          <input 
            type="password" 
            value={password} 
            onChange={e => setPassword(e.target.value)}
            style={{ padding: '1rem', borderRadius: '0.5rem', border: '1px solid gray', background: 'var(--bg)', color: 'var(--text)' }}
            placeholder="Ingrese su clave"
            required
          />
        </label>

        <button type="submit" disabled={loading} style={{ padding: '1rem', borderRadius: '0.5rem', background: 'var(--danger)', color: 'white', fontWeight: 'bold', border: 'none', cursor: loading ? 'wait' : 'pointer', marginTop: '1rem', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
          {loading ? <><Loader size={20} className="spin" /> VERIFICANDO...</> : 'INGRESAR'}
        </button>

        <Link to="/register" style={{ color: 'var(--text)', textAlign: 'center', marginTop: '1rem', textDecoration: 'none' }}>
           ¿Eres un Vecino nuevo? Crear Cuenta
        </Link>
      </form>
    </div>
  );
}
