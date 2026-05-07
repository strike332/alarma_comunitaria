import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

export const initWidgetService = async () => {
  if (!Capacitor.isNativePlatform()) return;

  try {
    let permStatus = await LocalNotifications.checkPermissions();
    if (permStatus.display === 'prompt') {
      permStatus = await LocalNotifications.requestPermissions();
    }
    
    if (permStatus.display !== 'granted') {
      console.log('Permisos de notificaciones locales denegados.');
      return;
    }

    // Register action types for the notification buttons
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: 'ALARM_ACTIONS',
          actions: [
            { id: 'trigger_Robo', title: '🚨 ROBO' },
            { id: 'trigger_Médica', title: '⚕️ MÉDICA' },
            { id: 'trigger_Incendio', title: '🔥 INCENDIO' }
          ]
        }
      ]
    });

  } catch (error) {
    console.error("Error al inicializar WidgetService:", error);
  }
};

export const showPersistentWidget = async () => {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display !== 'granted') return;

    // Create a persistent notification
    await LocalNotifications.schedule({
      notifications: [
        {
          title: 'Panel de Emergencia Rápido',
          body: 'Presiona un botón para pedir ayuda. Requerirá confirmación.',
          id: 999, // Un ID estático para poder actualizar o referenciar la misma notificación
          schedule: { at: new Date(Date.now() + 1000) },
          ongoing: true,
          autoCancel: false,
          actionTypeId: 'ALARM_ACTIONS',
          smallIcon: 'ic_stat_icon_config_sample' // Cambia esto según tu configuración de ícono nativo
        }
      ]
    });
    console.log("Widget persistente activado.");
  } catch (err) {
    console.error("Error al mostrar widget persistente:", err);
  }
};

export const removePersistentWidget = async () => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: 999 }] });
  } catch (err) {
    console.error("Error al remover widget:", err);
  }
};

export const addWidgetListener = (onAction) => {
  if (!Capacitor.isNativePlatform()) return;
  LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
    onAction(notificationAction.actionId);
  });
};
