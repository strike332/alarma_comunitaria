import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowLeft, Siren, Video } from 'lucide-react';
import { API_BASE } from './config';
import './App.css';

export default function EmergencyView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const sector = searchParams.get('sector');
  const token = searchParams.get('token');
  
  const [cameras, setCameras] = useState([]);
  const [error, setError] = useState(null);
  const [openingStream, setOpeningStream] = useState(false);
  
  // Extra parameters that might be passed from the Push Notification
  const neighbor = searchParams.get('neighbor');
  const address = searchParams.get('address');

  // Cargar lista de cámaras disponibles para este sector (para obtener el stream_link)
  useEffect(() => {
    if (!sector || !token) {
      setError("Faltan parámetros de emergencia");
      return;
    }

    fetch(`${API_BASE}/api/cameras/${encodeURIComponent(sector)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => {
        if (!r.ok) throw new Error("No autorizado o error de red");
        return r.json();
      })
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setCameras(data);
        } else {
          setCameras([{ id: null, stream_link: '' }]);
        }
      })
      .catch(err => {
        console.error(err);
        setError("No tienes permiso para ver estas cámaras o el token expiró.");
      });
  }, [sector, token]);

  if (error) {
    return (
      <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', textAlign: 'center' }}>
        <ShieldAlert size={80} color="var(--danger)" />
        <h1 style={{ color: 'var(--danger)', marginTop: '1rem' }}>Acceso Denegado</h1>
        <p style={{ margin: '1rem' }}>{error}</p>
        <button onClick={() => navigate('/')} className="close-button" style={{ background: 'var(--bg)', border: '1px solid gray' }}>
          Volver al Inicio
        </button>
      </div>
    );
  }

  const primaryCamera = cameras[0];
  const streamLink = primaryCamera?.stream_link;

  return (
    <div className="container emergency-view-page" style={{ padding: '1rem', minHeight: '100vh', background: '#450a0a', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={() => navigate('/')} className="icon-button" style={{ background: 'rgba(255,255,255,0.2)' }}>
          <ArrowLeft size={24} color="white" />
        </button>
        <div>
          <h1 style={{ fontSize: '1.2rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'white' }}>
            <Siren size={20} color="red" /> EMERGENCIA EN CURSO
          </h1>
          <p style={{ fontSize: '0.9rem', color: '#fca5a5', margin: 0 }}>Sector: {sector}</p>
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: '100%', 
          maxWidth: '500px', 
          background: 'rgba(0,0,0,0.8)',
          padding: '3rem 2rem',
          borderRadius: '1rem',
          border: '2px solid red',
          boxShadow: '0 0 50px rgba(255,0,0,0.5)',
          textAlign: 'center',
          animation: 'pulse-bg 2s infinite'
        }}>
          <ShieldAlert size={100} color="#ef4444" style={{ marginBottom: '1rem', animation: 'blink 1s infinite' }} />
          <h2 style={{ color: 'white', marginTop: 0, fontSize: '2rem', marginBottom: neighbor ? '1.5rem' : '2rem' }}>ALERTA ROJA</h2>
          
          {neighbor ? (
            <div style={{ background: '#7f1d1d', width: '100%', padding: '1.5rem', borderRadius: '0.5rem', marginBottom: '2rem', border: '2px solid red', textAlign: 'left' }}>
                <p style={{ color: '#fca5a5', fontSize: '1rem', margin: '0 0 0.5rem 0' }}>Vecino afectado:</p>
                <h1 style={{ color: 'white', fontSize: '2rem', margin: '0 0 0.5rem 0', wordBreak: 'break-word', lineHeight: '1.1' }}>{neighbor}</h1>
                <p style={{ color: 'white', fontSize: '1.1rem', margin: '0 0 1rem 0' }}>{address || 'Dirección no especificada'}</p>
                
                <a href={`tel:000000000`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem', background: 'var(--success)', color: 'white', textDecoration: 'none', borderRadius: '2rem', fontWeight: 'bold', fontSize: '1rem' }}>
                   📞 Llamar al vecino
                </a>
            </div>
          ) : (
            <p style={{ color: '#fca5a5', fontSize: '1.2rem', marginBottom: '2rem' }}>
              Se ha disparado una alarma en <strong>{sector}</strong>.
            </p>
          )}

          {streamLink ? (
            <button 
              onClick={() => {
                  setOpeningStream(true);
                  window.open(streamLink, '_blank');
                  setTimeout(() => setOpeningStream(false), 4000);
              }}
              disabled={openingStream}
              style={{
                width: '100%',
                padding: '1.5rem',
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '1.2rem',
                fontWeight: 'bold',
                cursor: openingStream ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)',
                opacity: openingStream ? 0.7 : 1
              }}
            >
              <Video size={24} /> {openingStream ? '⏳ Abriendo aplicación...' : 'VER TRANSMISIÓN EN VIVO'}
            </button>
          ) : (
            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.1)', borderRadius: '0.5rem', color: 'gray' }}>
              El administrador no ha configurado un link de transmisión pública para este sector.
            </div>
          )}
        </div>

        <button onClick={() => navigate('/')} className="close-button" style={{ marginTop: '3rem', maxWidth: '300px', background: 'transparent', border: '1px solid gray', color: 'gray' }}>
          SALIR DE LA VISTA
        </button>
      </main>
      
      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes pulse-bg { 0%, 100% { box-shadow: 0 0 50px rgba(255,0,0,0.5); } 50% { box-shadow: 0 0 80px rgba(255,0,0,0.8); } }
      `}</style>
    </div>
  );
}
