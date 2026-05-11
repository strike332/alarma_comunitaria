import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import { API_BASE } from './config';
import { QrCode, LogOut, CheckCircle2, Camera, Trash2, Ticket, CreditCard, Plus, Clock, Activity, Users, Radio, MapPin, Search, Edit2, ShieldAlert, Menu, X } from 'lucide-react';

export default function AdminPanel() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Modals state
  const [modal, setModal] = useState(null); // { type: 'alert'|'prompt'|'editUser', data: {}, onConfirm: fn }

  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState('cargando');
  
  // Data states
  const [hardwareList, setHardwareList] = useState([]);
  const [cameraList, setCameraList] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [sectorsList, setSectorsList] = useState([]);
  const [promoCodesList, setPromoCodesList] = useState([]);
  const [plansList, setPlansList] = useState([]);
  const [sniffLog, setSniffLog] = useState([]);
  const [alarmLogs, setAlarmLogs] = useState([]);
  
  const [userSearch, setUserSearch] = useState('');

  const token = localStorage.getItem('alarma_token');
  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

  // Form states
  const [newMac, setNewMac] = useState('');
  const [newSect, setNewSect] = useState('');
  const [newAlias, setNewAlias] = useState('');
  const [newSectorName, setNewSectorName] = useState('');
  const [newPromoCode, setNewPromoCode] = useState('');
  const [newPromoDays, setNewPromoDays] = useState(30);
  const [planName, setPlanName] = useState('');
  const [planPrice, setPlanPrice] = useState('');
  const [planDays, setPlanDays] = useState('30');
  const [planDesc, setPlanDesc] = useState('');

  const [camSector, setCamSector] = useState('');
  const [camBrand, setCamBrand] = useState('hikvision');
  const [camStreamLink, setCamStreamLink] = useState('');
  const [camConnectionType, setCamConnectionType] = useState('ip');
  const [camRtspUrl, setCamRtspUrl] = useState('');
  const [camIp, setCamIp] = useState('');
  const [camUser, setCamUser] = useState('admin');
  const [camPass, setCamPass] = useState('');

  const fetchHardware = async () => {
    try { const res = await axios.get(`${API_BASE}/api/admin/hardware`, authHeader); setHardwareList(res.data); } catch(err) { console.error(err); }
  };
  const fetchCameras = async () => {
    try { const res = await axios.get(`${API_BASE}/api/admin/cameras`, authHeader); setCameraList(Array.isArray(res.data) ? res.data : []); } catch(err) { console.error(err); }
  };
  const fetchUsers = async () => {
    try { const res = await axios.get(`${API_BASE}/api/admin/users`, authHeader); setUsersList(res.data); } catch(err) { console.error(err); }
  };
  const fetchSectors = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/sectors`, authHeader);
      setSectorsList(res.data);
      if (res.data.length > 0) {
        if (!newSect) setNewSect(res.data[0].name);
        if (!camSector) setCamSector(res.data[0].name);
      }
    } catch(err) { console.error(err); }
  };
  const fetchPromoCodes = async () => {
    try { const res = await axios.get(`${API_BASE}/api/admin/promo`, authHeader); setPromoCodesList(res.data); } catch(err) { console.error(err); }
  };
  const fetchPlans = async () => {
    try { const res = await axios.get(`${API_BASE}/api/admin/plans`, authHeader); setPlansList(Array.isArray(res.data) ? res.data : []); } catch(err) { console.error(err); }
  };
  const fetchLogs = async () => {
    try { const res = await axios.get(`${API_BASE}/api/admin/logs`, authHeader); setAlarmLogs(Array.isArray(res.data) ? res.data : []); } catch(err) { console.error(err); }
  };

  useEffect(() => {
    if (localStorage.getItem('alarma_role') !== 'admin') navigate('/');

    const socket = io(API_BASE);
    socket.on('whatsapp_qr', (qrString) => setQr(qrString));
    socket.on('whatsapp_status', (st) => { setStatus(st); if (st === 'conectado') setQr(null); });

    socket.on('rf_sniff_registered', data => setSniffLog(p => [{...data, known: true}, ...p].slice(0, 10)));
    socket.on('rf_sniff_unregistered', data => setSniffLog(p => [{...data, known: false}, ...p].slice(0, 10)));

    fetchHardware(); fetchCameras(); fetchUsers(); fetchSectors(); fetchPromoCodes(); fetchPlans();

    return () => socket.disconnect();
  }, [navigate]);

  const handleLogout = () => { localStorage.clear(); navigate('/'); };

  const showAlert = (message) => setModal({ type: 'alert', message });
  const showConfirm = (message, onConfirm) => setModal({ type: 'confirm', message, onConfirm });
  const showPrompt = (title, placeholder, onConfirm) => setModal({ type: 'prompt', title, placeholder, onConfirm });

  const triggerTest = async () => {
    showConfirm('¿Ejecutar Prueba Silenciosa de Conectividad?', async () => {
      try {
        await fetch(`${API_BASE}/api/alarm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, type: 'Prueba Silenciosa' })
        });
        showAlert('Prueba enviada');
      } catch { showAlert("Error"); }
    });
  };

  const handleRegisterMac = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/api/admin/hardware`, { macAddress: newMac, sector: newSect, alias: newAlias }, authHeader);
      setNewMac(''); setNewSect(''); setNewAlias('');
      fetchHardware();
      showAlert("¡Módulo Hardware registrado con éxito!");
    } catch (err) { showAlert("Error: " + (err.response?.data?.error || "Error de red")); }
  };

  const handleHardwareAction = async (mac, action) => {
    try {
      await axios.post(`${API_BASE}/api/admin/hardware/${mac}/action`, { action }, authHeader);
      showAlert(`Acción '${action}' completada`);
    } catch (err) { showAlert("Error: " + (err.response?.data?.error || "Falló la conexión")); }
  };

  const handleDeleteHardware = (mac) => {
    showConfirm('¿Eliminar esta placa del sistema de forma permanente?', async () => {
      try { await axios.delete(`${API_BASE}/api/admin/hardware/${mac}`, authHeader); fetchHardware(); } 
      catch(err) { showAlert("Error eliminando hardware"); }
    });
  };

  const handleScanNetwork = async () => {
    try {
      const res = await axios.post(`${API_BASE}/api/admin/hardware/scan`, {}, authHeader);
      setHardwareList(res.data);
    } catch(err) { showAlert("Error al escanear"); }
  };

  const handleUpdateAlias = (mac) => {
    showPrompt("Ingresa el nuevo Alias para esta placa:", "Ej: Poste Central", async (alias) => {
      if (!alias) return;
      try { await axios.put(`${API_BASE}/api/admin/hardware/${mac}`, { alias }, authHeader); fetchHardware(); } 
      catch(err) { showAlert("Error al editar alias"); }
    });
  };

  const handleAddControl = (userId, rfCodeOpt) => {
    if (rfCodeOpt) {
      addControlRequest(userId, rfCodeOpt);
    } else {
      showPrompt("Ingresa el código RF del llavero:", "Ej: 15661730", (code) => {
        if (code) addControlRequest(userId, code);
      });
    }
  };

  const addControlRequest = async (userId, code) => {
    try {
      await axios.post(`${API_BASE}/api/admin/users/${userId}/controls`, { rfCode: code }, authHeader);
      fetchUsers();
      showAlert("Llavero vinculado exitosamente");
    } catch(err) { showAlert("Error vinculando llavero"); }
  };

  const handleDeleteControl = (userId, rfCode) => {
    showConfirm(`¿Eliminar de raíz el llavero ${rfCode}?`, async () => {
      try { await axios.delete(`${API_BASE}/api/admin/users/${userId}/controls/${rfCode}`, authHeader); fetchUsers(); } 
      catch(err) { showAlert("Error eliminando llavero"); }
    });
  };

  const handleAddCamera = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/api/admin/cameras`, { 
        sector: camSector, brand: camBrand, stream_link: camStreamLink,
        connection_type: camConnectionType, rtsp_url: camRtspUrl,
        ip_address: camIp, username: camUser, password: camPass
      }, authHeader);
      setCamStreamLink(''); setCamRtspUrl(''); setCamIp(''); setCamPass('');
      fetchCameras();
      showAlert("¡Cámara registrada con éxito!");
    } catch (err) { showAlert("Error: " + (err.response?.data?.error || "Error de red")); }
  };

  const handleDeleteCamera = (id) => {
    showConfirm('¿Eliminar esta cámara?', async () => {
      try { await axios.delete(`${API_BASE}/api/admin/cameras/${id}`, authHeader); fetchCameras(); } 
      catch (err) { showAlert("Error al eliminar"); }
    });
  };

  const handleCreatePlan = async (e) => {
    e.preventDefault();
    if (!planName || !planPrice || !planDays) return showAlert("Completa nombre, precio y días");
    try {
      await axios.post(`${API_BASE}/api/admin/plans`, {
        name: planName, description: planDesc, price: parseInt(planPrice), duration_days: parseInt(planDays)
      }, authHeader);
      setPlanName(''); setPlanPrice(''); setPlanDays('30'); setPlanDesc('');
      fetchPlans(); showAlert("Plan creado");
    } catch(err) { showAlert("Error al crear plan"); }
  };

  const handleTogglePlan = async (id, isActive) => {
    try {
      await axios.patch(`${API_BASE}/api/admin/plans/${id}`, { is_active: !isActive }, authHeader);
      fetchPlans();
    } catch(err) { showAlert("Error"); }
  };

  const handleDeletePlan = (id) => {
    showConfirm('¿Eliminar este plan?', async () => {
      try { await axios.delete(`${API_BASE}/api/admin/plans/${id}`, authHeader); fetchPlans(); }
      catch(err) { showAlert("Error al eliminar"); }
    });
  };

  const handlePromoteUser = (userId, currentRole) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    showConfirm(`¿${newRole === 'admin' ? 'Promover a administrador' : 'Degradar a usuario'}?`, async () => {
      try {
        await axios.patch(`${API_BASE}/api/admin/users/${userId}/role`, { role: newRole }, authHeader);
        fetchUsers(); showAlert("Rol actualizado");
      } catch(err) { showAlert("Error al cambiar rol"); }
    });
  };

  const handleCleanLogs = () => {
    showConfirm('¿Eliminar registros de más de 30 días?', async () => {
      try { await axios.post(`${API_BASE}/api/admin/logs/clean`, { days: 30 }, authHeader); fetchLogs(); showAlert("Registros limpiados"); }
      catch(err) { showAlert("Error al limpiar"); }
    });
  };

  const handleRegisterSector = async (e) => {
    e.preventDefault();
    if (!newSectorName) return;
    try {
      await axios.post(`${API_BASE}/api/admin/sectors`, { name: newSectorName }, authHeader);
      setNewSectorName(''); fetchSectors(); showAlert("Sector creado");
    } catch(err) { showAlert("Error al crear sector"); }
  };

  const handleDeleteSector = (name) => {
    showConfirm(`¿Eliminar sector '${name}'? Solo se borrará de la lista global.`, async () => {
      try { await axios.delete(`${API_BASE}/api/admin/sectors/${name}`, authHeader); fetchSectors(); } 
      catch(err) { showAlert("Error al eliminar sector"); }
    });
  };
  
  const handleGeneratePromo = async (e) => {
    e.preventDefault();
    try {
        await axios.post(`${API_BASE}/api/admin/promo`, { code: newPromoCode, days: newPromoDays }, authHeader);
        setNewPromoCode(''); fetchPromoCodes(); showAlert("Código generado con éxito");
    } catch (err) { showAlert("Error al generar código"); }
  };

  const handleUpdateSubscription = (userId) => {
    showPrompt("¿Cuántos días quieres sumar a su suscripción?\n(Usa números negativos para restar)", "Ej: 30", async (days) => {
      if (!days || isNaN(days)) return;
      try {
          await axios.put(`${API_BASE}/api/admin/users/${userId}/subscription`, { days }, authHeader);
          fetchUsers(); showAlert("Suscripción actualizada");
      } catch (err) { showAlert("Error al actualizar"); }
    });
  };

  const handleDeleteUser = (userId, name) => {
    showConfirm(`¿Estás seguro de eliminar PERMANENTEMENTE al usuario '${name}' y todos sus llaveros?`, async () => {
      try {
        await axios.delete(`${API_BASE}/api/admin/users/${userId}`, authHeader);
        fetchUsers();
        showAlert("Usuario eliminado exitosamente.");
      } catch (err) {
        showAlert("Error al eliminar usuario.");
      }
    });
  };

  const renderModal = () => {
    if (!modal) return null;
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
        <div style={{ background: 'var(--bg)', padding: '2rem', borderRadius: '1rem', width: '90%', maxWidth: '400px', border: '1px solid gray' }}>
          {modal.type === 'alert' && (
            <>
              <h3>Alerta</h3>
              <p>{modal.message}</p>
              <button onClick={() => setModal(null)} style={{ background: 'var(--primary)', padding: '0.5rem 1rem', border: 'none', color: 'white', borderRadius: '0.5rem', cursor: 'pointer', width: '100%', marginTop: '1rem' }}>Aceptar</button>
            </>
          )}
          {modal.type === 'confirm' && (
            <>
              <h3>Confirmación</h3>
              <p>{modal.message}</p>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button onClick={() => setModal(null)} style={{ flex: 1, padding: '0.5rem', background: 'gray', border: 'none', color: 'white', borderRadius: '0.5rem', cursor: 'pointer' }}>Cancelar</button>
                <button onClick={() => { modal.onConfirm(); setModal(null); }} style={{ flex: 1, padding: '0.5rem', background: 'var(--danger)', border: 'none', color: 'white', borderRadius: '0.5rem', cursor: 'pointer' }}>Confirmar</button>
              </div>
            </>
          )}
          {modal.type === 'prompt' && (
            <form onSubmit={(e) => { e.preventDefault(); const val = e.target.input.value; modal.onConfirm(val); setModal(null); }}>
              <h3>{modal.title}</h3>
              <input name="input" autoFocus placeholder={modal.placeholder} style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid gray', background: 'var(--bg)', color: 'white', marginTop: '1rem' }} />
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setModal(null)} style={{ flex: 1, padding: '0.5rem', background: 'gray', border: 'none', color: 'white', borderRadius: '0.5rem', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" style={{ flex: 1, padding: '0.5rem', background: 'var(--primary)', border: 'none', color: 'white', borderRadius: '0.5rem', cursor: 'pointer' }}>Aceptar</button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  };

  const filteredUsers = usersList.filter(u => 
    u.name.toLowerCase().includes(userSearch.toLowerCase()) || 
    u.phone.includes(userSearch)
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0a0a0a', color: 'white', fontFamily: 'system-ui, sans-serif' }}>
      {renderModal()}
      
      {/* Hamburger Mobile Button */}
      <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{
        position: 'fixed', top: '1rem', left: '1rem', zIndex: 1001, background: '#171717', border: '1px solid #333',
        color: 'white', borderRadius: '0.5rem', padding: '0.5rem', cursor: 'pointer', display: 'none'
      }} className="hamburger-btn">
        {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Overlay mobile */}
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 998 }} className="sidebar-overlay" />}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} style={{ width: '250px', background: '#171717', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', minHeight: '100vh', zIndex: 999 }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldAlert size={28} color="var(--primary)" />
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Admin Panel</h2>
        </div>
        <nav style={{ flex: 1, padding: '1rem 0', overflowY: 'auto' }}>
          {[
            { id: 'dashboard', icon: <Activity size={20}/>, label: 'Dashboard' },
            { id: 'users', icon: <Users size={20}/>, label: 'Usuarios' },
            { id: 'hardware', icon: <Radio size={20}/>, label: 'Hardware ESP32' },
            { id: 'cameras', icon: <Camera size={20}/>, label: 'Cámaras IP / P2P' },
            { id: 'sectors', icon: <MapPin size={20}/>, label: 'Sectores' },
            { id: 'plans', icon: <CreditCard size={20}/>, label: 'Planes' },
            { id: 'promo', icon: <Ticket size={20}/>, label: 'Promociones' },
            { id: 'logs', icon: <Activity size={20}/>, label: 'Registros' },
            { id: 'whatsapp', icon: <QrCode size={20}/>, label: 'WhatsApp Bot' },
          ].map(tab => (
            <button key={tab.id} onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }} style={{
              width: '100%', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem',
              background: activeTab === tab.id ? 'var(--primary)' : 'transparent', color: 'white', border: 'none', cursor: 'pointer',
              textAlign: 'left', transition: 'background 0.2s'
            }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: '1rem', borderTop: '1px solid #333' }}>
          <button onClick={handleLogout} style={{ width: '100%', padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: '#262626', color: 'var(--danger)', border: '1px solid #333', borderRadius: '0.5rem', cursor: 'pointer' }}>
            <LogOut size={20} /> Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
        
        {activeTab === 'dashboard' && (
          <div className="fade-in">
            <h1 style={{ marginTop: 0 }}>Panel General</h1>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
              <div style={{ background: '#171717', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #333' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', color: 'gray' }}>Total Usuarios</h3>
                <p style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold' }}>{usersList.length}</p>
              </div>
              <div style={{ background: '#171717', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #333' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', color: 'gray' }}>Suscripciones Activas</h3>
                <p style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold', color: 'var(--medical)' }}>
                  {usersList.filter(u => u.subscription_status === 'active').length}
                </p>
              </div>
              <div style={{ background: '#171717', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #333' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', color: 'gray' }}>Hardware Online</h3>
                <p style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold', color: '#22c55e' }}>
                  {hardwareList.filter(h => h.isOnline).length} / {hardwareList.length}
                </p>
              </div>
              <div style={{ background: '#171717', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #333' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', color: 'gray' }}>Cámaras</h3>
                <p style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold' }}>{cameraList.length}</p>
              </div>
            </div>
            
            <div style={{ background: '#171717', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #333' }}>
              <h2>Acciones Rápidas</h2>
              <button onClick={triggerTest} style={{ padding: '1rem 2rem', borderRadius: '0.5rem', background: 'var(--medical)', color: 'white', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>
                📢 Ejecutar Prueba Silenciosa (Ping de Red)
              </button>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="fade-in">
            <h1 style={{ marginTop: 0 }}>Gestión de Usuarios</h1>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', background: '#171717', padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid #333', flex: 1 }}>
                <Search size={20} color="gray" />
                <input 
                  type="text" 
                  placeholder="Buscar por nombre o teléfono..." 
                  value={userSearch} 
                  onChange={e => setUserSearch(e.target.value)} 
                  style={{ background: 'transparent', border: 'none', color: 'white', outline: 'none', padding: '0.5rem', width: '100%' }} 
                />
              </div>
            </div>
            
            <div style={{ background: '#171717', borderRadius: '1rem', border: '1px solid #333', overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#262626' }}>
                    <th style={{ padding: '1rem' }}>Vecino</th>
                    <th style={{ padding: '1rem' }}>Sector</th>
                    <th style={{ padding: '1rem' }}>Suscripción</th>
                    <th style={{ padding: '1rem' }}>Llaveros (RF)</th>
                    <th style={{ padding: '1rem' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((usr) => (
                    <tr key={usr.id} style={{ borderBottom: '1px solid #333' }}>
                      <td style={{ padding: '1rem' }}>
                          <div style={{ fontWeight: 'bold' }}>{usr.name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'gray' }}>ID #{usr.id} | {usr.phone}</div>
                      </td>
                      <td style={{ padding: '1rem' }}>{usr.sector}</td>
                      <td style={{ padding: '1rem' }}>
                          <span style={{ padding: '0.2rem 0.5rem', borderRadius: '0.25rem', background: usr.subscription_status === 'active' ? 'var(--medical)' : 'var(--danger)', fontSize: '0.8rem' }}>
                              {usr.subscription_status?.toUpperCase()}
                          </span>
                          <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'gray' }}>
                              Vence: {usr.subscription_expiry ? new Date(usr.subscription_expiry).toLocaleDateString() : 'N/A'}
                          </div>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                          {usr.controls && usr.controls.map(code => (
                            <span key={code} style={{ background: '#262626', padding: '0.2rem 0.5rem', borderRadius: '1rem', border: '1px solid #444', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                               {code}
                               <button onClick={() => handleDeleteControl(usr.id, code)} style={{ background:'none', border:'none', color:'var(--danger)', cursor:'pointer' }}>×</button>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: '1rem' }}>
                           <div style={{ display: 'flex', gap: '0.5rem' }}>
                               <button onClick={() => handlePromoteUser(usr.id, usr.role)} title={usr.role === 'admin' ? 'Degradar a usuario' : 'Promover a admin'} style={{ background: usr.role === 'admin' ? '#f59e0b' : '#262626', border: '1px solid #444', color: 'white', padding: '0.5rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
                                   <ShieldAlert size={16} />
                               </button>
                               <button onClick={() => handleUpdateSubscription(usr.id)} title="Gestionar Suscripción" style={{ background: '#262626', border: '1px solid #444', color: 'white', padding: '0.5rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
                                  <Clock size={16} />
                              </button>
                              <button onClick={() => handleAddControl(usr.id)} title="Añadir Llavero" style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.5rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
                                  <Plus size={16} />
                              </button>
                              <button onClick={() => handleDeleteUser(usr.id, usr.name)} title="Eliminar Usuario" style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '0.5rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
                                  <Trash2 size={16} />
                              </button>
                          </div>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && <tr><td colSpan="5" style={{ padding: '2rem', textAlign: 'center', color: 'gray' }}>No se encontraron usuarios.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'hardware' && (
          <div className="fade-in">
            <h1 style={{ marginTop: 0 }}>Gestión de Hardware ESP32</h1>
            
            <div style={{ background: '#171717', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #333', marginBottom: '2rem' }}>
              <h3>Vincular Nuevo Módulo Físico</h3>
              <form onSubmit={handleRegisterMac} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <input type="text" placeholder="Alias (Ej: Poste Central)" value={newAlias} onChange={e => setNewAlias(e.target.value)} style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }} />
                <input type="text" required placeholder="MAC: 1C:C3:AB:..." value={newMac} onChange={e => setNewMac(e.target.value)} style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }} />
                <select required value={newSect} onChange={e => setNewSect(e.target.value)} style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }}>
                  {sectorsList.length === 0 && <option value="">(Crea un sector primero)</option>}
                  {sectorsList.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
                <button type="submit" style={{ padding: '0.75rem 2rem', background: 'var(--medical)', border: 'none', color: 'white', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer' }}>Añadir</button>
              </form>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
              <button onClick={handleScanNetwork} style={{ background: 'var(--primary)', color: 'white', padding: '0.75rem 1.5rem', border: 'none', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer' }}>
                📡 Escanear Red (Ping)
              </button>
            </div>

            <div style={{ background: '#171717', borderRadius: '1rem', border: '1px solid #333', overflowX: 'auto', marginBottom: '2rem' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#262626' }}>
                    <th style={{ padding: '1rem' }}>Alias</th>
                    <th style={{ padding: '1rem' }}>Sector</th>
                    <th style={{ padding: '1rem' }}>Dirección MAC</th>
                    <th style={{ padding: '1rem' }}>Estado</th>
                    <th style={{ padding: '1rem' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {hardwareList.map((hw) => (
                    <tr key={hw.mac_address} style={{ borderBottom: '1px solid #333' }}>
                      <td style={{ padding: '1rem', fontWeight: 'bold' }}>
                         {hw.alias || '-'}
                         <button onClick={() => handleUpdateAlias(hw.mac_address)} style={{ marginLeft: '0.5rem', cursor: 'pointer', background: 'none', border: 'none', color: 'gray' }}><Edit2 size={14}/></button>
                      </td>
                      <td style={{ padding: '1rem' }}>{hw.sector}</td>
                      <td style={{ padding: '1rem', fontFamily: 'monospace', fontSize: '0.9rem' }}>{hw.mac_address}</td>
                      <td style={{ padding: '1rem', color: hw.isOnline ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>
                        {hw.isOnline ? `Online (${hw.ip})` : 'Offline'}
                      </td>
                      <td style={{ padding: '1rem', display: 'flex', gap: '0.5rem' }}>
                        <button disabled={!hw.isOnline} onClick={() => handleHardwareAction(hw.mac_address, 'activar')} title="Probar Sirena" style={{ cursor: hw.isOnline ? 'pointer' : 'not-allowed', background: hw.isOnline ? '#ef4444' : '#444', color: 'white', border: 'none', borderRadius: '0.25rem', padding: '0.5rem' }}>🔔</button>
                        <button disabled={!hw.isOnline} onClick={() => handleHardwareAction(hw.mac_address, 'silenciar')} title="Silenciar Sirena" style={{ cursor: hw.isOnline ? 'pointer' : 'not-allowed', background: hw.isOnline ? '#22c55e' : '#444', color: 'white', border: 'none', borderRadius: '0.25rem', padding: '0.5rem' }}>🔇</button>
                        <button disabled={!hw.isOnline} onClick={() => handleHardwareAction(hw.mac_address, 'identificar')} title="Identificar" style={{ cursor: hw.isOnline ? 'pointer' : 'not-allowed', background: hw.isOnline ? '#3b82f6' : '#444', color: 'white', border: 'none', borderRadius: '0.25rem', padding: '0.5rem' }}>💡</button>
                        <button onClick={() => handleDeleteHardware(hw.mac_address)} title="Eliminar" style={{ cursor: 'pointer', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: '0.25rem', padding: '0.5rem' }}><Trash2 size={16}/></button>
                      </td>
                    </tr>
                  ))}
                  {hardwareList.length === 0 && <tr><td colSpan="5" style={{ padding: '2rem', textAlign: 'center', color: 'gray' }}>No hay hardware registrado.</td></tr>}
                </tbody>
              </table>
            </div>

            <div style={{ background: '#171717', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #333' }}>
              <h3 style={{ marginTop: 0 }}>Monitor de Radiofrecuencia (Sniffer)</h3>
              <p style={{ color: 'gray', fontSize: '0.9rem', marginBottom: '1rem' }}>Presiona un botón en cualquier llavero 433mhz para interceptarlo aquí.</p>
              <div style={{ background: '#0a0a0a', padding: '1rem', borderRadius: '0.5rem', minHeight: '150px', fontFamily: 'monospace', color: '#38bdf8', overflowY: 'auto' }}>
                 {sniffLog.length === 0 ? <p style={{ color: 'gray' }}>Esperando señales...</p> : sniffLog.map((log, i) => (
                   <div key={i} style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px dashed #333', paddingBottom: '0.5rem' }}>
                     <div>
                       <div style={{ color: 'gray', fontSize: '0.8rem' }}>[{new Date(log.timestamp).toLocaleTimeString()}] vía {log.macAddress}</div>
                       {log.known 
                          ? <div style={{color: '#22c55e', marginTop: '0.25rem'}}>✅ VALIDADO: Llavero de {log.neighbor} ({log.sector}) - Code: {log.rfCode}</div>
                          : <div style={{color: '#ef4444', marginTop: '0.25rem'}}>⚠️ DESCONOCIDO: Código RF {log.rfCode}</div>
                       }
                      </div>
                      {!log.known && (
                         <button onClick={() => {
                            showPrompt("Asignar llavero " + log.rfCode + ".\nIngresa el ID del usuario:", "Ej: 1", (id) => {
                              if (id) handleAddControl(id, log.rfCode);
                            });
                         }} style={{ background: 'var(--primary)', color: 'white', padding: '0.4rem 0.8rem', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}>
                           Vincular a Vecino
                         </button>
                      )}
                   </div>
                 ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'cameras' && (
          <div className="fade-in">
            <h1 style={{ marginTop: 0 }}>Cámaras de Seguridad</h1>
            
            <div style={{ background: '#171717', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #333', marginBottom: '2rem' }}>
              <h3>Añadir Nueva Cámara</h3>
              <form onSubmit={handleAddCamera} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <select required value={camSector} onChange={e => setCamSector(e.target.value)} style={{ flex: 1, minWidth: '200px', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }}>
                    {sectorsList.length === 0 && <option value="">(Crea un sector primero)</option>}
                    {sectorsList.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                  <select value={camBrand} onChange={e => setCamBrand(e.target.value)} style={{ flex: 1, minWidth: '150px', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }}>
                    <option value="hikvision">Hikvision / EZVIZ</option>
                    <option value="dahua">Dahua / Imou</option>
                  </select>
                  <select value={camConnectionType} onChange={e => setCamConnectionType(e.target.value)} style={{ flex: 1, minWidth: '130px', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }}>
                    <option value="ip">IP Directa (HTTP/ISAPI)</option>
                    <option value="rtsp">RTSP Stream</option>
                    <option value="p2p">P2P (Nube)</option>
                  </select>
                </div>

                {camConnectionType === 'rtsp' && (
                  <div style={{ padding: '1rem', background: '#262626', borderRadius: '0.5rem', border: '1px dashed #f59e0b' }}>
                    <p style={{ color: '#f59e0b', marginTop: 0, fontSize: '0.9rem' }}>URL del stream RTSP. El servidor extraerá frames con ffmpeg.</p>
                    <input type="text" required placeholder="rtsp://admin:pass@192.168.1.x:554/cam/realmonitor?channel=1&subtype=0" value={camRtspUrl} onChange={e => setCamRtspUrl(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#171717', color: 'white', fontFamily: 'monospace' }} />
                  </div>
                )}

                {camConnectionType === 'p2p' && (
                  <div style={{ padding: '1rem', background: '#262626', borderRadius: '0.5rem', border: '1px dashed #3b82f6' }}>
                    <p style={{ color: '#60a5fa', marginTop: 0, fontSize: '0.9rem' }}>Pega el enlace de compartir desde DMSS</p>
                    <input type="url" required placeholder="https://dmss..." value={camStreamLink} onChange={e => setCamStreamLink(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#171717', color: 'white' }} />
                  </div>
                )}

                {camConnectionType === 'ip' && (
                  <div style={{ padding: '1rem', background: '#262626', borderRadius: '0.5rem', border: '1px dashed #4ade80' }}>
                    <p style={{ color: '#4ade80', marginTop: 0, fontSize: '0.9rem' }}>Datos de conexión IP directa (HTTP/ISAPI)</p>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <input type="text" required placeholder="IP: 192.168.x.x" value={camIp} onChange={e => setCamIp(e.target.value)} style={{ flex: 1, minWidth: '150px', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#171717', color: 'white', fontFamily: 'monospace' }} />
                      <input type="text" required placeholder="Usuario" value={camUser} onChange={e => setCamUser(e.target.value)} style={{ flex: 1, minWidth: '120px', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#171717', color: 'white' }} />
                      <input type="password" required placeholder="Contraseña" value={camPass} onChange={e => setCamPass(e.target.value)} style={{ flex: 1, minWidth: '120px', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#171717', color: 'white' }} />
                    </div>
                  </div>
                )}

                <button type="submit" style={{ padding: '1rem', background: 'var(--primary)', border: 'none', color: 'white', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer', alignSelf: 'flex-start' }}>
                  Añadir Cámara
                </button>
              </form>
            </div>

            <div style={{ background: '#171717', borderRadius: '1rem', border: '1px solid #333', overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#262626' }}>
                    <th style={{ padding: '1rem' }}>Sector</th>
                    <th style={{ padding: '1rem' }}>Marca</th>
                    <th style={{ padding: '1rem' }}>Tipo</th>
                    <th style={{ padding: '1rem' }}>Link / RTSP</th>
                    <th style={{ padding: '1rem' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {cameraList.map((cam) => (
                    <tr key={cam.id} style={{ borderBottom: '1px solid #333' }}>
                      <td style={{ padding: '1rem' }}>{cam.sector}</td>
                      <td style={{ padding: '1rem', textTransform: 'capitalize' }}>{cam.brand}</td>
                      <td style={{ padding: '1rem' }}>
                        <span style={{ padding: '0.2rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.8rem', background: cam.connection_type === 'rtsp' ? '#f59e0b44' : cam.connection_type === 'p2p' ? '#3b82f644' : '#22c55e44', color: cam.connection_type === 'rtsp' ? '#fbbf24' : cam.connection_type === 'p2p' ? '#60a5fa' : '#4ade80' }}>
                          {cam.connection_type?.toUpperCase() || 'IP'}
                        </span>
                      </td>
                      <td style={{ padding: '1rem', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cam.rtsp_url ? (
                          <span title={cam.rtsp_url} style={{ color: '#fbbf24', fontFamily: 'monospace', fontSize: '0.8rem' }}>{cam.rtsp_url.substring(0, 40)}...</span>
                        ) : cam.stream_link ? (
                          <a href={cam.stream_link} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'none' }}>Ver Link</a>
                        ) : (
                          <span style={{ color: 'gray' }}>Sin link</span>
                        )}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <button onClick={() => handleDeleteCamera(cam.id)} style={{ background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', padding: '0.5rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {cameraList.length === 0 && <tr><td colSpan="5" style={{ padding: '2rem', textAlign: 'center', color: 'gray' }}>No hay cámaras registradas.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'sectors' && (
          <div className="fade-in">
            <h1 style={{ marginTop: 0 }}>Gestión de Sectores</h1>
            <div style={{ background: '#171717', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #333', marginBottom: '2rem' }}>
              <form onSubmit={handleRegisterSector} style={{ display: 'flex', gap: '1rem' }}>
                <input type="text" placeholder="Nombre del nuevo sector (Ej: Barrio Centro)" value={newSectorName} onChange={e => setNewSectorName(e.target.value)} style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }} />
                <button type="submit" style={{ padding: '0.75rem 2rem', background: 'var(--medical)', border: 'none', color: 'white', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer' }}>Crear Sector</button>
              </form>
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {sectorsList.map(s => (
                <div key={s.name} style={{ background: '#171717', padding: '1rem 1.5rem', borderRadius: '0.5rem', border: '1px solid #333', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ fontWeight: 'bold' }}>{s.name}</span>
                  <button onClick={() => handleDeleteSector(s.name)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.2rem' }}><Trash2 size={18}/></button>
                </div>
              ))}
              {sectorsList.length === 0 && <p style={{ color: 'gray' }}>No hay sectores creados.</p>}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="fade-in">
            <h1 style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Registro de Actividad
              <button onClick={handleCleanLogs} style={{ padding: '0.5rem 1rem', background: '#262626', color: 'var(--danger)', border: '1px solid #444', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                Limpiar +30 días
              </button>
            </h1>
            <button onClick={fetchLogs} style={{ marginBottom: '1rem', padding: '0.5rem 1rem', background: 'var(--primary)', border: 'none', color: 'white', borderRadius: '0.5rem', cursor: 'pointer' }}>Cargar registros</button>
            <div style={{ background: '#171717', borderRadius: '1rem', border: '1px solid #333', overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#262626' }}>
                    <th style={{ padding: '1rem' }}>Fecha</th>
                    <th style={{ padding: '1rem' }}>Usuario</th>
                    <th style={{ padding: '1rem' }}>Evento</th>
                    <th style={{ padding: '1rem' }}>Sector</th>
                  </tr>
                </thead>
                <tbody>
                  {alarmLogs.map((log, i) => (
                    <tr key={log.id || i} style={{ borderBottom: '1px solid #333' }}>
                      <td style={{ padding: '1rem', fontSize: '0.85rem' }}>{new Date(log.timestamp).toLocaleString()}</td>
                      <td style={{ padding: '1rem' }}>{log.user_name || 'Sistema'}</td>
                      <td style={{ padding: '1rem' }}>{log.event_type}</td>
                      <td style={{ padding: '1rem' }}>{log.sector}</td>
                    </tr>
                  ))}
                  {alarmLogs.length === 0 && <tr><td colSpan="4" style={{ padding: '2rem', textAlign: 'center', color: 'gray' }}>Clic en "Cargar registros" para ver la actividad.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'promo' && (
          <div className="fade-in">
            <h1 style={{ marginTop: 0 }}>Códigos Promocionales</h1>
            <div style={{ background: '#171717', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #333', marginBottom: '2rem' }}>
              <form onSubmit={handleGeneratePromo} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <input type="text" required placeholder="Código (EJ: VECINO_ORO)" value={newPromoCode} onChange={e => setNewPromoCode(e.target.value.toUpperCase())} style={{ flex: 2, padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }} />
                <input type="number" required placeholder="Días (Ej: 30)" value={newPromoDays} onChange={e => setNewPromoDays(e.target.value)} style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }} />
                <button type="submit" style={{ padding: '0.75rem 2rem', background: 'var(--medical)', border: 'none', color: 'white', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer' }}>
                  Generar Código
                </button>
              </form>
            </div>
            <div style={{ background: '#171717', borderRadius: '1rem', border: '1px solid #333', overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ background: '#262626' }}>
                        <th style={{ padding: '1rem' }}>Código</th>
                        <th style={{ padding: '1rem' }}>Días</th>
                        <th style={{ padding: '1rem' }}>Estado</th>
                        <th style={{ padding: '1rem' }}>Usado por</th>
                    </tr>
                </thead>
                <tbody>
                    {promoCodesList.map(p => (
                        <tr key={p.id} style={{ borderBottom: '1px solid #333' }}>
                            <td style={{ padding: '1rem', fontWeight: 'bold', fontFamily: 'monospace', color: 'var(--primary)' }}>{p.code}</td>
                            <td style={{ padding: '1rem' }}>+{p.duration_days} días</td>
                            <td style={{ padding: '1rem' }}>
                                <span style={{ color: p.is_used ? 'gray' : '#22c55e', fontWeight: 'bold' }}>
                                    {p.is_used ? 'Usado' : 'Disponible'}
                                </span>
                            </td>
                            <td style={{ padding: '1rem', color: 'gray' }}>{p.used_by_name || '-'}</td>
                        </tr>
                    ))}
                    {promoCodesList.length === 0 && <tr><td colSpan="4" style={{ padding: '2rem', textAlign: 'center', color: 'gray' }}>No hay códigos promocionales generados.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'plans' && (
          <div className="fade-in">
            <h1 style={{ marginTop: 0 }}>Planes de Suscripción</h1>
            <div style={{ background: '#171717', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #333', marginBottom: '2rem' }}>
              <form onSubmit={handleCreatePlan} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <input type="text" required placeholder="Nombre del plan" value={planName} onChange={e => setPlanName(e.target.value)} style={{ flex: 2, padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }} />
                  <input type="number" required placeholder="Precio (CLP)" value={planPrice} onChange={e => setPlanPrice(e.target.value)} style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }} />
                  <input type="number" required placeholder="Días" value={planDays} onChange={e => setPlanDays(e.target.value)} style={{ flex: 1, padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }} />
                </div>
                <input type="text" placeholder="Descripción (opcional)" value={planDesc} onChange={e => setPlanDesc(e.target.value)} style={{ padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #444', background: '#262626', color: 'white' }} />
                <button type="submit" style={{ padding: '0.75rem 2rem', background: 'var(--medical)', border: 'none', color: 'white', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer', alignSelf: 'flex-start' }}>
                  Crear Plan
                </button>
              </form>
            </div>
            <div style={{ background: '#171717', borderRadius: '1rem', border: '1px solid #333', overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#262626' }}>
                    <th style={{ padding: '1rem' }}>Plan</th>
                    <th style={{ padding: '1rem' }}>Precio</th>
                    <th style={{ padding: '1rem' }}>Duración</th>
                    <th style={{ padding: '1rem' }}>Estado</th>
                    <th style={{ padding: '1rem' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {plansList.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #333' }}>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ fontWeight: 'bold' }}>{p.name}</div>
                        {p.description && <div style={{ fontSize: '0.8rem', color: 'gray' }}>{p.description}</div>}
                      </td>
                      <td style={{ padding: '1rem' }}>${p.price?.toLocaleString()} {p.currency}</td>
                      <td style={{ padding: '1rem' }}>{p.duration_days} días</td>
                      <td style={{ padding: '1rem' }}>
                        <span style={{ color: p.is_active ? '#22c55e' : 'gray', fontWeight: 'bold' }}>
                          {p.is_active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td style={{ padding: '1rem', display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => handleTogglePlan(p.id, p.is_active)} style={{ background: p.is_active ? '#444' : 'var(--medical)', border: 'none', color: 'white', padding: '0.5rem 0.75rem', borderRadius: '0.25rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                          {p.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                        <button onClick={() => handleDeletePlan(p.id)} style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '0.5rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {plansList.length === 0 && <tr><td colSpan="5" style={{ padding: '2rem', textAlign: 'center', color: 'gray' }}>No hay planes creados. Crea uno para que aparezca en el paywall.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'whatsapp' && (
          <div className="fade-in">
            <h1 style={{ marginTop: 0 }}>Estado de WhatsApp</h1>
            <div style={{ background: '#171717', padding: '2rem', borderRadius: '1rem', border: '1px solid #333', textAlign: 'center', maxWidth: '500px', margin: '0 auto' }}>
              <h2 style={{ marginTop: 0, color: status === 'conectado' ? '#22c55e' : 'white' }}>Estado: {status.toUpperCase()}</h2>
              {status === 'esperando_qr' && qr && (
                <div style={{ marginTop: '1.5rem' }}>
                  <p style={{ color: 'gray', marginBottom: '1rem' }}>Escanea este código con el WhatsApp del dispositivo bot</p>
                  <div style={{ background: 'white', padding: '1rem', display: 'inline-block', borderRadius: '1rem' }}>
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qr)}`} alt="QR Code WhatsApp" />
                  </div>
                </div>
              )}
              {status === 'conectado' && (
                <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: '#22c55e' }}>
                  <CheckCircle2 size={80} />
                  <p style={{ fontWeight: 'bold', fontSize: '1.2rem', margin: 0 }}>¡Bot Conectado Perfectamente!</p>
                  <p style={{ color: 'gray', fontSize: '0.9rem' }}>El sistema está listo para enviar alertas a los grupos de vecinos.</p>
                </div>
              )}
              {status === 'cargando' && (
                <p style={{ color: 'gray', marginTop: '1rem' }}>Iniciando cliente de WhatsApp... (Esto puede demorar unos segundos)</p>
              )}
            </div>
          </div>
        )}

      </main>
      
      <style>{`
        .fade-in { animation: fadeIn 0.3s ease-in-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 768px) {
          .sidebar { position: fixed; left: -260px; top: 0; bottom: 0; transition: left 0.3s; }
          .sidebar.open { left: 0; }
          .hamburger-btn { display: flex !important; }
          table { font-size: 0.8rem; }
          th, td { padding: 0.5rem !important; }
        }
        .sidebar-overlay { display: none; }
        @media (max-width: 768px) {
          .sidebar-overlay { display: block; }
        }
      `}</style>
    </div>
  );
}
