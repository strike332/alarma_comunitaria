import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Siren, Stethoscope, Users, ShieldAlert, Settings, Moon, Sun, ArrowLeft, LogOut, Radio, Trash2, CreditCard, Ticket, Clock, Flame, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { initPushNotifications } from './PushService';
import { initWidgetService, showPersistentWidget, addWidgetListener } from './WidgetService';
import { API_BASE } from './config';
import './App.css';

const socket = io(API_BASE);

export default function AlarmaPanel() {
  const [activeAlert, setActiveAlert] = useState(null);
  const [status, setStatus] = useState('conectado');
  const [currentView, setCurrentView] = useState('main'); // 'main' | 'settings'
  const [theme, setTheme] = useState('dark');
  const [rfStatus, setRfStatus] = useState('idle'); // idle | listening | paired | testing | tested
  const [controlsList, setControlsList] = useState([]);
  const [promoCode, setPromoCode] = useState('');
  const [promoMessage, setPromoMessage] = useState(null);
  const [pendingTriggerType, setPendingTriggerType] = useState(null);
  const [isExpired, setIsExpired] = useState(false);
  const navigate = useNavigate();
  
  const isAdmin = localStorage.getItem('alarma_role') === 'admin';

  // Change class on body when theme changes
  useEffect(() => {
    document.body.className = theme;
  }, [theme]);

  useEffect(() => {
    socket.on('connect', () => setStatus('conectado'));
    socket.on('disconnect', () => setStatus('desconectado'));

    socket.on('alarm_trigger', (data) => {
      setActiveAlert(data);
      if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
    });

    socket.on('silence_alarm', () => {
      setActiveAlert(null);
    });

    const token = localStorage.getItem('alarma_token');
    if (token) {
      // Iniciar Push Notifications
      initPushNotifications(token);
      
      // Iniciar Widget Persistente
      initWidgetService().then(() => {
          showPersistentWidget();
      });

      addWidgetListener((actionId) => {
          if (actionId.startsWith('trigger_')) {
              const type = actionId.replace('trigger_', '');
              setPendingTriggerType(type);
          }
      });

      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        socket.on(`rf_paired_success_${payload.id}`, (data) => {
          setRfStatus('paired');
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        });
        socket.on(`rf_test_success_${payload.id}`, (data) => {
          setRfStatus('tested');
          if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
        });
      } catch (e) {}
    }

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('alarm_trigger');
    };
  }, []);

  // ✅ FIX #9: Verificación de expiración real desde el backend al cargar el panel
  useEffect(() => {
    const token = localStorage.getItem('alarma_token');
    if (!token) return;
    // Chequeo rápido: si el JWT ya expirado (firma inválida), desloguear
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp && Date.now() / 1000 > payload.exp) {
        localStorage.clear();
        navigate('/');
      }
    } catch (e) {}
  }, [navigate]);

  const handleRedeemCode = async () => {
    const token = localStorage.getItem('alarma_token');
    try {
        const res = await fetch(`${API_BASE}/api/promo/redeem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ code: promoCode })
        });
        const data = await res.json();
        if (res.ok) {
            setPromoMessage({ type: 'success', text: `¡Éxito! Expira el: ${data.newExpiry}` });
            setIsExpired(false);
            setPromoCode('');
        } else {
            setPromoMessage({ type: 'error', text: data.error });
        }
    } catch (err) {
        setPromoMessage({ type: 'error', text: "Error de conexión" });
    }
  };

  const handlePay = async () => {
    const token = localStorage.getItem('alarma_token');
    try {
        const res = await fetch(`${API_BASE}/api/subscription/create`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.init_point) {
            window.location.href = data.init_point;
        }
    } catch (err) {
        alert("Error al conectar con Mercado Pago");
    }
  };

  const loadControls = async () => {
    const token = localStorage.getItem('alarma_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/rf/controls`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setControlsList(data || []);
    } catch(err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (currentView === 'settings') {
      loadControls();
    }
  }, [currentView]);

  const triggerRfListen = async () => {
    setRfStatus('listening');
    const token = localStorage.getItem('alarma_token');
    await fetch(`${API_BASE}/api/rf/listen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    setTimeout(() => setRfStatus((prev) => prev === 'listening' ? 'idle' : prev), 30000);
  };

  const triggerRfTest = async () => {
    setRfStatus('testing');
    const token = localStorage.getItem('alarma_token');
    await fetch(`${API_BASE}/api/rf/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    setTimeout(() => setRfStatus((prev) => prev === 'testing' ? 'idle' : prev), 30000);
  };

  const removeControl = async (rfCode) => {
    if(!window.confirm(`¿Seguro que deseas desvincular el control #${rfCode}?`)) return;
    const token = localStorage.getItem('alarma_token');
    await fetch(`${API_BASE}/api/rf/controls/${rfCode}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    loadControls();
  };

  const triggerAlarm = async (type) => {
    const result = window.confirm(`¿Seguro que quieres enviar una alerta de ${type.toUpperCase()}?`);
    if (!result) return;

    try {
      const token = localStorage.getItem('alarma_token');
      const res = await fetch(`${API_BASE}/api/alarm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          type: type
        })
      });
      
      if (res.status === 403) {
          const data = await res.json();
          if (data.code === "SUBSCRIPTION_EXPIRED") {
              setIsExpired(true);
          } else {
              alert(data.error);
          }
      }
    } catch (err) {
      alert("Error al conectar con el servidor de alarmas");
    }
  };

  const logout = () => {
    localStorage.clear();
    navigate('/');
  };

  if (currentView === 'settings') {
    return (
      <div className="container">
        <header className="settings-header">
          <button className="icon-button" onClick={() => setCurrentView('main')}>
            <ArrowLeft size={28} />
          </button>
          <h2>Configuración</h2>
          <button className="icon-button" onClick={logout}>
            <LogOut size={28} color="var(--danger)" />
          </button>
        </header>
        <main className="settings-main">
          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-title">Apariencia</span>
              <span className="setting-desc">Tema {theme === 'dark' ? 'Oscuro' : 'Claro'}</span>
            </div>
            <button 
              className="theme-toggle-btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Moon size={24} /> : <Sun size={24} />}
            </button>
          </div>

          <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
            <div className="setting-info" style={{ width: '100%', borderBottom: '1px solid gray', paddingBottom: '1rem' }}>
              <span className="setting-title">Cambiar Contraseña</span>
              <span className="setting-desc">Actualiza tu clave de acceso</span>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const oldPw = e.target.currentPassword.value;
              const newPw = e.target.newPassword.value;
              const token = localStorage.getItem('alarma_token');
              try {
                const res = await fetch(`${API_BASE}/api/change-password`, {
                  method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                  body: JSON.stringify({ currentPassword: oldPw, newPassword: newPw })
                });
                const data = await res.json();
                alert(res.ok ? 'Contraseña actualizada' : data.error);
                if (res.ok) { e.target.reset(); }
              } catch { alert('Error de conexión'); }
            }} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input name="currentPassword" type="password" required placeholder="Contraseña actual" style={{ padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid gray', background: 'var(--bg)', color: 'white' }} />
              <input name="newPassword" type="password" required minLength="4" placeholder="Nueva contraseña (mín 4 caracteres)" style={{ padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid gray', background: 'var(--bg)', color: 'white' }} />
              <button type="submit" style={{ padding: '0.75rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer' }}>CAMBIAR CONTRASEÑA</button>
            </form>
          </div>

          <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
            <div className="setting-info" style={{ width: '100%', borderBottom: '1px solid gray', paddingBottom: '1rem' }}>
                <span className="setting-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Ticket size={20} /> Código Promocional
                </span>
                <span className="setting-desc">Canjea un código para activar tu suscripción</span>
            </div>
            <div style={{ width: '100%', display: 'flex', gap: '0.5rem' }}>
                <input 
                    type="text" 
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    placeholder="EJ: PROMO2024"
                    style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid gray', background: 'var(--bg)', color: 'white' }}
                />
                <button onClick={handleRedeemCode} style={{ padding: '0.75rem 1.5rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer' }}>
                    CANJEAR
                </button>
            </div>
            {promoMessage && (
                <div style={{ color: promoMessage.type === 'success' ? 'var(--medical)' : 'var(--danger)', fontSize: '0.9rem', fontWeight: 'bold' }}>
                    {promoMessage.text}
                </div>
            )}
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-title">Suscripción Premium</span>
              <span className="setting-desc">Acceso ilimitado a alertas y cámaras</span>
            </div>
            <button onClick={handlePay} style={{ padding: '0.75rem 1rem', background: 'var(--medical)', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <CreditCard size={18} /> PAGAR
            </button>
          </div>

          {isAdmin && (
            <div className="setting-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
              <div className="setting-info" style={{ width: '100%', borderBottom: '1px solid gray', paddingBottom: '1rem' }}>
                <span className="setting-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Radio size={20} /> Llavero de Alarma Físico (Admin)
                </span>
                <span className="setting-desc">Vincula controles remotos a usuarios (Solo Administradores)</span>
              </div>
              
              <div style={{ width: '100%', textAlign: 'center' }}>
                {(rfStatus === 'idle' || rfStatus === 'tested') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <button onClick={triggerRfListen} style={{ padding: '0.75rem 2rem', background: 'var(--card)', color: 'var(--text)', border: '1px solid gray', borderRadius: '0.5rem', cursor: 'pointer', width: '100%' }}>
                      1. Añadir Llavero Remoto Nuevo
                    </button>
                    <button onClick={triggerRfTest} style={{ padding: '0.75rem 2rem', background: 'var(--card)', color: 'var(--medical)', border: '1px solid var(--medical)', borderRadius: '0.5rem', cursor: 'pointer', width: '100%' }}>
                      2. Hacer PRUEBA TÉCNICA del Llavero (Modo Silencioso)
                    </button>
                  </div>
                )}
                {rfStatus === 'listening' && (
                  <div style={{ padding: '1rem', background: 'var(--warning)', color: 'black', borderRadius: '0.5rem', fontWeight: 'bold' }}>
                    ⏳ MODO DE BÚSQUEDA ACTIVADO: Presiona cualquier botón de tu control remoto AHORA... (Buscando señal nueva)
                  </div>
                )}
                {rfStatus === 'testing' && (
                  <div style={{ padding: '1rem', background: 'var(--warning)', color: 'black', borderRadius: '0.5rem', fontWeight: 'bold' }}>
                    🛠️ MODO DE PRUEBA ACTIVADO: Presiona tu llavero. El sistema interceptará la señal sin disparar la sirena ni avisar a WhatsApp...
                  </div>
                )}
                {rfStatus === 'paired' && (
                  <div style={{ padding: '1rem', background: 'var(--medical)', color: 'white', borderRadius: '0.5rem', fontWeight: 'bold' }}>
                    ✔️ Llavero vinculado exitosamente.
                    <button onClick={() => { setRfStatus('idle'); loadControls(); }} style={{ padding: '0.5rem 1rem', marginTop: '1rem', background: 'var(--bg)', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}>Aceptar</button>
                  </div>
                )}
                {rfStatus === 'tested' && (
                  <div style={{ padding: '1rem', background: 'var(--medical)', color: 'white', borderRadius: '0.5rem', fontWeight: 'bold', marginTop: '1rem' }}>
                    ✔️ PRUEBA EXITOSA: Tu sistema físico se comunicó al milisegundo con tu internet.
                    <button onClick={() => setRfStatus('idle')} style={{ padding: '0.5rem 1rem', marginTop: '1rem', background: 'var(--bg)', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', marginLeft: '1rem' }}>Aceptar</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* LISTA DE CONTROLES (Visible para todos si tienen) */}
          <div style={{ width: '100%', marginTop: '2rem', padding: '1rem', background: 'var(--card)', borderRadius: '0.5rem', border: '1px solid gray' }}>
            <h3 style={{ margin: '0 0 1rem 0', display: 'flex', justifyContent: 'space-between' }}>
              Mis Controles Activos
              <span style={{ background: 'var(--primary)', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.9rem' }}>
                {controlsList.length}
              </span>
            </h3>
            
            {controlsList.length === 0 ? (
              <p style={{ color: 'gray', fontStyle: 'italic' }}>No tienes controles vinculados.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {controlsList.map((ctrl) => (
                  <li key={ctrl.rf_code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--bg)', marginBottom: '0.5rem', borderRadius: '0.25rem' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '1.1rem' }}>#{ctrl.rf_code}</span>
                    {isAdmin && (
                      <button 
                        onClick={() => removeControl(ctrl.rf_code)}
                        style={{ background: 'var(--danger)', color: 'white', border: 'none', padding: '0.4rem', borderRadius: '0.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        title="Desvincular Controlador"
                      >
                        <Trash2 size={20} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="container">
      <header>
        <div className="header-top">
          <h1>ALERTA COMUNITARIA</h1>
          <button className="icon-button" onClick={() => setCurrentView('settings')}>
            <Settings size={28} />
          </button>
        </div>
        <div className="status-bar">
          <div className={`status-dot ${status}`} />
          Sistema {status.toUpperCase()}
          &nbsp;| {localStorage.getItem('alarma_name')}
        </div>
      </header>

      <main className="grid" style={{ marginBottom: '2rem' }}>
        <button className="alarm-button robo" onClick={() => triggerAlarm('Robo')}>
          <div className="button-icon"><Siren size={48} /></div>
          <span className="button-label">ROBO</span>
        </button>

        <button className="alarm-button medica" onClick={() => triggerAlarm('Emergencia Médica')}>
          <div className="button-icon"><Stethoscope size={48} /></div>
          <span className="button-label">MÉDICA</span>
        </button>

        <button className="alarm-button incendio" onClick={() => triggerAlarm('Incendio')}>
          <div className="button-icon"><Flame size={48} /></div>
          <span className="button-label">INCENDIO</span>
        </button>

        <button className="alarm-button asistencia" onClick={() => triggerAlarm('Asistencia')}>
          <div className="button-icon"><Users size={48} /></div>
          <span className="button-label">ASISTENCIA</span>
        </button>
      </main>

      <footer className="footer">
        Protección Vecinal - Pulse prolongado para ayuda
      </footer>

      {activeAlert && (
        <AlertOverlay alert={activeAlert} onClose={() => setActiveAlert(null)} />
      )}

      {isExpired && (
        <PaywallOverlay onRedeem={() => { setCurrentView('settings'); setIsExpired(false); }} onPay={handlePay} />
      )}

      {pendingTriggerType && (
        <ConfirmWidgetOverlay 
            type={pendingTriggerType} 
            onConfirm={() => {
                triggerAlarm(pendingTriggerType);
                setPendingTriggerType(null);
            }} 
            onCancel={() => setPendingTriggerType(null)} 
        />
      )}
    </div>
  );
}

function ConfirmWidgetOverlay({ type, onConfirm, onCancel }) {
    return (
        <div className="alert-overlay" style={{ background: 'rgba(0,0,0,0.95)', zIndex: 2000 }}>
            <ShieldAlert size={120} color="var(--danger)" style={{ marginBottom: '2rem', animation: 'blink 1s infinite' }} />
            <h2 style={{ color: 'white', textAlign: 'center', fontSize: '2.5rem', marginBottom: '1rem', lineHeight: '1.2' }}>
                ¿ESTÁS SEGURO DE ACTIVAR LA ALARMA?
            </h2>
            <p style={{ color: 'var(--danger)', fontWeight: 'bold', fontSize: '1.8rem', marginBottom: '3rem', textTransform: 'uppercase' }}>
                Tipo: {type}
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '400px' }}>
                <button onClick={onConfirm} style={{ padding: '1.5rem', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '1rem', fontWeight: 'bold', fontSize: '1.5rem', cursor: 'pointer', boxShadow: '0 0 20px rgba(239, 68, 68, 0.5)' }}>
                    SÍ, ACTIVAR AHORA
                </button>
                <button onClick={onCancel} style={{ padding: '1.5rem', background: 'transparent', color: 'gray', border: '2px solid gray', borderRadius: '1rem', fontWeight: 'bold', fontSize: '1.2rem', cursor: 'pointer' }}>
                    CANCELAR
                </button>
            </div>
        </div>
    );
}

function PaywallOverlay({ onRedeem, onPay }) {
    return (
        <div className="alert-overlay" style={{ background: 'rgba(0,0,0,0.95)', zIndex: 1000 }}>
            <CreditCard size={100} color="var(--danger)" style={{ marginBottom: '2rem' }} />
            <h2 style={{ color: 'white', textAlign: 'center', fontSize: '2rem', marginBottom: '1rem' }}>
                SUSCRIPCIÓN VENCIDA
            </h2>
            <p style={{ color: '#ccc', textAlign: 'center', maxWidth: '400px', marginBottom: '2rem', fontSize: '1.2rem' }}>
                Para seguir protegiendo a tu comunidad y acceder a las cámaras, debes activar tu suscripción.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '400px' }}>
                <button onClick={onPay} style={{ padding: '1.2rem', background: 'var(--medical)', color: 'white', border: 'none', borderRadius: '0.75rem', fontWeight: 'bold', fontSize: '1.2rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <CreditCard size={24} /> PAGAR SUSCRIPCIÓN ($5.000/mes)
                </button>
                
                <button onClick={onRedeem} style={{ padding: '1.2rem', background: 'var(--card)', color: 'white', border: '1px solid gray', borderRadius: '0.75rem', fontWeight: 'bold', fontSize: '1.2rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <Ticket size={24} /> TENGO UN CÓDIGO
                </button>
                
                <p style={{ color: 'gray', textAlign: 'center', fontSize: '0.9rem', marginTop: '1rem' }}>
                    Si crees que esto es un error, contacta al administrador de tu sector.
                </p>
            </div>
        </div>
    );
}

// Subcomponente separado para manejar los frames de la cámara en vivo 
// sin forzar al panel completo a re-renderizarse
function AlertOverlay({ alert, onClose }) {
  const [cameras, setCameras] = useState([]);
  const [camIndex, setCamIndex] = useState(0);
  const [imageSrc, setImageSrc] = useState('');
  const [silenceError, setSilenceError] = useState(null);
  const [openingStream, setOpeningStream] = useState(false);
  const [streamUrl, setStreamUrl] = useState(null);
  const intervalRef = React.useRef(null);
  const heartbeatRef = React.useRef(null);
  const videoRef = React.useRef(null);
  
  const sector = alert.sector || localStorage.getItem('alarma_sector') || 'Sector Norte';
  const token = localStorage.getItem('alarma_token');

  // Cargar lista de cámaras disponibles para este sector
  useEffect(() => {
    fetch(`${API_BASE}/api/cameras/${encodeURIComponent(sector)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setCameras(data);
        } else {
          setCameras([{ id: null }]);
        }
      })
      .catch(() => setCameras([{ id: null }]));
  }, [sector, token]);

  // Doble buffer: precargar imagen (solo si NO estamos en modo streaming)
  useEffect(() => {
    if (streamUrl) return;
    if (cameras.length === 0) return;
    const activeCam = cameras[camIndex];

    const loadFrame = () => {
      const baseUrl = activeCam?.id
        ? `${API_BASE}/api/emergency-view/${encodeURIComponent(sector)}/${activeCam.id}?token=${token}`
        : `${API_BASE}/api/emergency-view/${encodeURIComponent(sector)}?token=${token}`;
      
      const img = new Image();
      img.onload = () => setImageSrc(img.src);
      img.src = `${baseUrl}&tz=${Date.now()}`;
    };

    loadFrame();
    intervalRef.current = setInterval(loadFrame, 1000);
    return () => clearInterval(intervalRef.current);
  }, [cameras, camIndex, sector, token, streamUrl]);

  // Heartbeat para mantener vivo el stream HLS
  useEffect(() => {
    if (!streamUrl) return;
    heartbeatRef.current = setInterval(() => {
      fetch(`${API_BASE}/api/stream/${encodeURIComponent(sector)}/heartbeat`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
    }, 8000);
    return () => clearInterval(heartbeatRef.current);
  }, [streamUrl, sector, token]);

  // Limpiar al cerrar
  const handleClose = () => {
    setStreamUrl(null);
    onClose();
  };

  const handleSilence = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/silenciar`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 403) {
          setSilenceError(`🛑 Esta alerta fue activada por ${alert.neighbor}. Por seguridad, solo él o un administrador pueden silenciarla para asegurar que el peligro haya pasado.`);
          setTimeout(() => setSilenceError(null), 7000);
      } else {
          handleClose();
      }
    } catch (err) {
      console.error("Error al silenciar:", err);
      handleClose();
    }
  };

  const handleStartStream = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/stream/${encodeURIComponent(sector)}/start`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.url) {
        setStreamUrl(`${API_BASE}${data.url}`);
        clearInterval(intervalRef.current);
      }
    } catch (err) {
      console.error("Error al iniciar stream:", err);
    }
  };

  return (
    <div className="alert-overlay" style={{ overflowY: 'auto', padding: '2rem 1rem' }}>
      <ShieldAlert size={80} color="white" style={{ animation: 'blink 1s infinite' }} />
      <h2 className="alert-message" style={{ marginBottom: '0.5rem' }}>
        🚨 ALERTA ACTIVA 🚨<br/>
        {alert.type}
      </h2>
      
      <div style={{ background: '#7f1d1d', width: '100%', maxWidth: '600px', padding: '1.5rem', borderRadius: '0.5rem', marginBottom: '1.5rem', border: '2px solid red' }}>
          <p style={{ color: '#fca5a5', fontSize: '1rem', margin: '0 0 0.5rem 0' }}>Vecino afectado:</p>
          <h1 style={{ color: 'white', fontSize: '2.5rem', margin: '0 0 0.5rem 0', wordBreak: 'break-word', lineHeight: '1.1' }}>{alert.neighbor}</h1>
          <p style={{ color: 'white', fontSize: '1.2rem', margin: '0 0 1rem 0' }}>{alert.address}</p>
          
          <a href={`tel:000000000`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem', background: 'var(--success)', color: 'white', textDecoration: 'none', borderRadius: '2rem', fontWeight: 'bold', fontSize: '1.1rem' }}>
             📞 Llamar al vecino
          </a>
      </div>
      
      {/* Visor de cámaras */}
      <div style={{
        width: '100%', 
        maxWidth: '600px',
        background: 'black',
        borderRadius: '0.75rem',
        overflow: 'hidden',
        marginBottom: '1.5rem',
        border: '2px solid red',
        position: 'relative',
        minHeight: '280px',
        aspectRatio: '16/9',
      }}>
        <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 10, background: 'red', color: 'white', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.8rem', animation: 'blink 1s infinite' }}>
          {streamUrl ? 'EN VIVO' : 'REC VIVO'}
        </div>
        
        {cameras.length > 1 && (
          <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 10, background: 'rgba(0,0,0,0.7)', color: 'white', padding: '2px 10px', borderRadius: '4px', fontSize: '0.85rem' }}>
            📷 {camIndex + 1} / {cameras.length}
          </div>
        )}

        {streamUrl ? (
          <video
            ref={videoRef}
            src={streamUrl}
            autoPlay
            playsInline
            muted
            controls
            style={{ width: '100%', height: 'auto', display: 'block', minHeight: '200px', background: 'black' }}
            onError={() => { setStreamUrl(null); setOpeningStream(false); }}
          />
        ) : (
          <>
            {imageSrc && <img 
              src={imageSrc}
              alt="Cámara de Seguridad CCTV"
              style={{ width: '100%', height: 'auto', display: 'block', minHeight: '200px', background: 'black' }}
            />}
            {!imageSrc && <div style={{ width: '100%', minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: '0.9rem' }}>Conectando con cámara...</div>}
          </>
        )}

        {cameras.length > 1 && !streamUrl && (
          <>
            <button
              onClick={() => setCamIndex(i => (i - 1 + cameras.length) % cameras.length)}
              style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: '40px', height: '40px', fontSize: '1.4rem', cursor: 'pointer', zIndex: 10 }}
              title="Cámara anterior"
            >‹</button>
            <button
              onClick={() => setCamIndex(i => (i + 1) % cameras.length)}
              style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: '40px', height: '40px', fontSize: '1.4rem', cursor: 'pointer', zIndex: 10 }}
              title="Cámara siguiente"
            >›</button>
          </>
        )}
      </div>

      {cameras.length > 1 && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '1.5rem', justifyContent: 'center' }}>
          {cameras.map((_, i) => (
            <button
              key={i}
              onClick={() => setCamIndex(i)}
              style={{
                width: '12px', height: '12px',
                borderRadius: '50%',
                background: i === camIndex ? 'white' : 'rgba(255,255,255,0.35)',
                border: 'none', cursor: 'pointer', padding: 0,
                transition: 'background 0.2s'
              }}
              title={`Cámara ${i + 1}`}
            />
          ))}
        </div>
      )}

      {!streamUrl && (
        <button 
          onClick={handleStartStream}
          disabled={openingStream}
          style={{ width: '100%', maxWidth: '600px', padding: '1.2rem', background: '#ef4444', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '1.2rem', fontWeight: 'bold', cursor: openingStream ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '1rem', opacity: openingStream ? 0.7 : 1 }}
        >
          <Video size={24} /> {openingStream ? '⏳ Iniciando transmisión...' : 'VER TRANSMISIÓN EN VIVO (HLS)'}
        </button>
      )}
      {streamUrl && (
        <button 
          onClick={() => setStreamUrl(null)}
          style={{ width: '100%', maxWidth: '600px', padding: '0.8rem', background: '#262626', color: 'gray', border: '1px solid #444', borderRadius: '0.5rem', fontSize: '1rem', cursor: 'pointer', marginBottom: '1rem' }}
        >
          Volver a vista de snapshots
        </button>
      )}

      {silenceError && (
          <div style={{ width: '100%', maxWidth: '600px', padding: '1rem', background: 'var(--danger)', color: 'white', borderRadius: '0.5rem', marginBottom: '1rem', fontWeight: 'bold', animation: 'blink 1s infinite' }}>
              {silenceError}
          </div>
      )}

      <button className="close-button" onClick={handleSilence} style={{ width: '100%', maxWidth: '600px' }}>
        ENTENDIDO / SILENCIAR
      </button>

      <button 
        onClick={handleClose}
        style={{ marginTop: '1rem', background: 'transparent', color: 'gray', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontSize: '1rem' }}
      >
        Cierre forzado (Solo Visual)
      </button>
    </div>
  );
}
