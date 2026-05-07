import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import axios from 'axios';
import { API_BASE } from './config';

export const initPushNotifications = async (userToken) => {
  if (!Capacitor.isNativePlatform()) {
    console.log('Push notifications are only supported on native devices (Android/iOS).');
    return;
  }

  try {
    // Solicitar permisos al usuario (Crítico para Android 13+)
    let permStatus = await PushNotifications.checkPermissions();
    
    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      console.log('❌ Permiso de notificaciones denegado por el usuario');
      return;
    }

    // Registrar dispositivo en FCM
    await PushNotifications.register();

    // Listener para cuando nos llega el Token de FCM
    PushNotifications.addListener('registration', async (token) => {
      console.log('✅ FCM Token recibido:', token.value);
      
      // Enviar el token a nuestro backend
      try {
        const serverUrl = `${API_BASE}/api/users/fcm-token`;
        await axios.post(serverUrl, { token: token.value }, {
          headers: { Authorization: `Bearer ${userToken}` }
        });
        console.log("📡 FCM Token guardado en el servidor");
      } catch(e) {
        console.error("⚠️ Error al guardar FCM Token en servidor", e);
      }
    });

    PushNotifications.addListener('registrationError', (error) => {
      console.error('Error al registrar push:', error);
    });

    // Cuando llega la alerta y la app está ABIERTA
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('🚨 Alerta Push Recibida en Primer Plano:', notification);
      // Aquí podríamos mostrar un modal gigante dentro de la app
    });

    // Cuando el usuario TOCA la notificación (estando cerrada o de fondo)
    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('👆 Acción de Push seleccionada:', notification);
      
      // Si el usuario toca la notificación, lo llevamos a EmergencyView
      const data = notification.notification.data;
      if (data && data.sector) {
         window.location.href = `/emergencia?sector=${encodeURIComponent(data.sector)}`;
      }
    });

  } catch (error) {
    console.error("Error inicializando Push Notifications", error);
  }
};
