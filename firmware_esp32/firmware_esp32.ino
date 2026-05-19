/*
  FIRMWARE PARA ALARMA COMUNITARIA ESP32 (VERSION FINAL SAAS)
  Totalmente adaptado al mapa de hardware real documentado en:
  "RESUMEN DE FUNCIONAMIENTO DE PINES DEL ESP.pdf"

  MAPA DE PINES DEFINITIVO (Documentación Oficial de la Placa):
  ──────────────────────────────────────────────────────────────
  PIN IO 26 → SALIDA → Relé EXTERNO (Activa con LOW/0V, Desactiva = Alta impedancia/HIGH-Z)
  PIN IO 32 → SALIDA → Relé ORIGINAL de la placa (Activa con HIGH/>3.3V, Desactiva = LOW)
  PIN IO 27 → SALIDA → Buzzer interno (Intermitente HIGH cuando sin internet)
  PIN IO 33 → SALIDA → LED Azul (HIGH = WiFi conectado, Intermitente = buscando)
  PIN IO 13 → ENTRADA → MicroSwitch reset WiFi (Tiene 5V permanente, switch inyecta 0V)
  PIN  D0/2 → ENTRADA → Receptor RF 433 MHz (Datos del control remoto)
  ──────────────────────────────────────────────────────────────
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiManager.h> // Librería para el Portal Cautivo WiFi
#include <Preferences.h> // Librería para guardar datos no volátiles (NVS)
#include <ELECHOUSE_CC1101_SRC_DRV.h> // Librería Driver ESP32 para CC1101
#include <RCSwitch.h>
#include <WebServer.h>

// --- Funciones auxiliares Digest Auth ---
String digestMD5(const String& str) {
  MD5Builder md5;
  md5.begin();
  md5.add(str);
  md5.calculate();
  return md5.toString();
}

String base64Encode(const String& input) {
  const char* b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String out;
  int val = 0, bits = -6;
  for (unsigned int i = 0; i < input.length(); i++) {
    val = (val << 8) + input[i]; bits += 8;
    while (bits >= 0) { out += b64[(val >> bits) & 0x3F]; bits -= 6; }
  }
  if (bits > -6) out += b64[((val << 8) >> (bits + 8)) & 0x3F];
  while (out.length() % 4) out += '=';
  return out;
}

String randomHex(int len) {
  String s;
  for (int i = 0; i < len; i++) {
    s += String(random(0, 16), HEX);
  }
  return s;
}

// --- MAPA DE HARDWARE DEFINITIVO (Documentado en PDF) ---
const int PIN_ANTENA        = 4;   // D4 - Receptor RF 433 MHz (GDO0 del CC1101 va conectado AQUÍ, ya no en el 2)
const int PIN_RELE_EXTERNO  = 26;  // Relé externo: LOW = activar, HIGH = desactivar firmemente
const int PIN_RELE_ORIGINAL = 32;  // Relé original: HIGH = activar, LOW = desactivar
const int PIN_BUZZER        = 27;  // Buzzer interno
const int PIN_LED_AZUL      = 33;  // LED Azul indicador WiFi
const int PIN_BOTON_WIFI    = 13;  // MicroSwitch reset WiFi (INPUT_PULLUP, activo LOW)

// --- CONFIGURACION DE RED ---
// El SSID y Password ahora son gestionados dinámicamente por WiFiManager
// La IP del backend ahora se configura dinámicamente
String backendIP;
String serverUrl;
String registerUrl;

// ========== ESTADOS GLOBALES ==========
Preferences preferences;
RCSwitch mySwitch = RCSwitch();
bool isAlarmActive = false;
unsigned long alarmStartTime = 0;
unsigned long lastActionTime = 0;
const unsigned long ALARM_TIMEOUT_MS = 180000;
const unsigned long LOCKOUT_MS = 1000;

// === WHITELIST OFFLINE ===
// Códigos RF autorizados localmente (sincronizados desde el backend)
#define MAX_AUTHORIZED_CODES 50
String authorizedCodes[MAX_AUTHORIZED_CODES];
int authorizedCount = 0;
unsigned long lastSyncTime = 0;
const unsigned long SYNC_INTERVAL_MS = 300000; // Sincronizar cada 5 minutos

// Variables para el monitoreo del botón WiFi reset
unsigned long lastWifiCheckTime = 0;
const unsigned long WIFI_CHECK_INTERVAL = 500; // Revisar cada 500ms

// === CAMARA LOCAL (Snapshots via HTTP) ===
String camIP = "192.168.100.131";
String camUser = "admin";
String camPass = "admin1234";
unsigned long lastSnapshotTime = 0;
const unsigned long SNAPSHOT_INTERVAL_MS = 5000;
String snapshotAuth;

// === COMMAND LONG POLLING (Respuesta instantánea desde la nube) ===
bool pollingActive = false;
unsigned long lastPollCheck = 0;
const unsigned long POLL_GAP_MS = 1000;

void consultarComandosPendientes() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (pollingActive) return;
  if (millis() - lastPollCheck < POLL_GAP_MS) return;
  
  lastPollCheck = millis();
  pollingActive = true;
  HTTPClient http;
  String mac = WiFi.macAddress();
  String pollUrl = "http://" + backendIP + ":3001/api/esp/pending/" + mac;
  http.begin(pollUrl);
  http.setTimeout(2000); // timeout corto: 2 segundos

  int httpCode = http.GET();

  if (httpCode == 200) {
    String body = http.getString();
    if (body.indexOf("\"activar\"") > 0 || body.indexOf("\"toggle\"") > 0) {
      Serial.println("📋 Comando instantáneo: ACTIVAR");
      if (!isAlarmActive) encenderAlarma();
    } else if (body.indexOf("\"silenciar\"") > 0) {
      Serial.println("📋 Comando instantáneo: SILENCIAR");
      if (isAlarmActive) apagarAlarma();
    } else if (body.indexOf("\"identificar\"") > 0) {
      Serial.println("📋 Comando instantáneo: IDENTIFICAR");
      for (int i = 0; i < 3; i++) {
        pinMode(PIN_RELE_EXTERNO, OUTPUT);
        digitalWrite(PIN_RELE_EXTERNO, LOW); digitalWrite(PIN_BUZZER, HIGH);
        delay(150);
        digitalWrite(PIN_RELE_EXTERNO, HIGH); digitalWrite(PIN_BUZZER, LOW);
        delay(150);
      }
      apagarAlarma();
    }
  }
  http.end();
  pollingActive = false;
}

// ============================================================
// FUNCIÓN: Capturar snapshot de cámara local y subirlo al droplet
// ============================================================
void capturarYSubirSnapshot() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (camIP.length() < 7) return;
  if (millis() - lastSnapshotTime < SNAPSHOT_INTERVAL_MS) return;
  lastSnapshotTime = millis();

  String uri = "/onvifsnapshot/media_service/snapshot?channel=1&subtype=0";
  WiFiClient client;

  // Paso 1: GET sin auth
  if (!client.connect(camIP.c_str(), 80)) { Serial.println("📷 no conecta"); return; }
  client.print("GET " + uri + " HTTP/1.1\r\nHost: " + camIP + "\r\nConnection: close\r\n\r\n");
  
  String statusLine = client.readStringUntil('\n');
  int code = 0;
  if (statusLine.indexOf("200") > 0) code = 200;
  else if (statusLine.indexOf("401") > 0) code = 401;

  // Leer headers
  String rawHeaders = "";
  while (client.connected() || client.available()) {
    String l = client.readStringUntil('\n');
    if (l.length() <= 1) break;
    rawHeaders += l + "\n";
  }
  client.stop();

  if (code == 401) {
    String realm = "", nonce = "", qop = "auth";
    int p = rawHeaders.indexOf("realm=\"");
    if (p >= 0) { p += 7; int e = rawHeaders.indexOf("\"", p); if (e >= 0) realm = rawHeaders.substring(p, e); }
    p = rawHeaders.indexOf("nonce=\"");
    if (p >= 0) { p += 7; int e = rawHeaders.indexOf("\"", p); if (e >= 0) nonce = rawHeaders.substring(p, e); }
    p = rawHeaders.indexOf("qop=\"");
    if (p >= 0) { p += 5; int e = rawHeaders.indexOf("\"", p); if (e >= 0) qop = rawHeaders.substring(p, e); }
    
    Serial.print("realm="); Serial.println(realm);
    
    if (nonce.length() > 0 && realm.length() > 0) {
      String nc = "00000001", cnonce = randomHex(8);
      String ha1 = digestMD5(camUser + ":" + realm + ":" + camPass);
      String ha2 = digestMD5("GET:" + uri);
      String respVal = digestMD5(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":" + qop + ":" + ha2);

      WiFiClient client2;
      if (client2.connect(camIP.c_str(), 80)) {
        String auth = "Digest username=\"" + camUser + "\", realm=\"" + realm + 
          "\", nonce=\"" + nonce + "\", uri=\"" + uri + "\", qop=" + qop + 
          ", nc=" + nc + ", cnonce=\"" + cnonce + "\", response=\"" + respVal + "\"";
        client2.print("GET " + uri + " HTTP/1.1\r\nHost: " + camIP + "\r\nAuthorization: " + auth + "\r\nConnection: close\r\n\r\n");
        
        statusLine = client2.readStringUntil('\n');
        code = statusLine.indexOf("200") > 0 ? 200 : 0;
        
        // Saltar headers
        while (client2.connected() || client2.available()) {
          String l = client2.readStringUntil('\n');
          if (l.length() <= 1) break;
        }
        
        if (code == 200) {
          delay(100);
          int total = 0;
          uint8_t* jpeg = (uint8_t*)malloc(60000);
          if (jpeg) {
            unsigned long t0 = millis();
            while (millis() - t0 < 4000 && total < 59000) {
              if (client2.available()) {
                total += client2.readBytes(jpeg + total, client2.available());
              } else if (!client2.connected()) { delay(50); if (!client2.available()) break; }
              delay(10);
            }
            client2.stop();
            if (total > 100) {
              HTTPClient httpServer;
              String mac = WiFi.macAddress();
              httpServer.begin("http://" + backendIP + ":3001/api/esp/snapshot?mac=" + mac);
              httpServer.addHeader("Content-Type", "image/jpeg");
              httpServer.setTimeout(3000);
              httpServer.POST(jpeg, total);
              httpServer.end();
              Serial.print("📷");
            }
            free(jpeg);
            return;
          }
          client2.stop();
          client2.stop();
        }
      }
    }
  } else if (code == 200) {
    // Cámara aceptó sin auth — leer JPEG
    int total = 0;
    uint8_t* jpeg = (uint8_t*)malloc(60000);
    if (jpeg) {
      unsigned long t0 = millis();
      while (millis() - t0 < 3000 && total < 199000) {
        if (client.available()) { total += client.readBytes(jpeg + total, client.available()); }
        else if (!client.connected()) break;
        delay(5);
      }
      client.stop();
      Serial.print(" len="); Serial.println(total);
      if (total > 100) {
        HTTPClient httpServer;
        String mac = WiFi.macAddress();
        httpServer.begin("http://" + backendIP + ":3001/api/esp/snapshot?mac=" + mac);
        httpServer.addHeader("Content-Type", "image/jpeg");
        httpServer.setTimeout(3000);
        int up = httpServer.POST(jpeg, total);
        Serial.print("subido="); Serial.println(up);
        httpServer.end();
      }
      free(jpeg);
    }
  } else {
    Serial.print("code="); Serial.println(code);
  }
}

WebServer server(80);

// ============================================================
// FUNCIÓN: Encender Alarma Física (Ambos Relés)
// ============================================================
void encenderAlarma() {
  // Relé Externo (PIN 26): Cambia a OUTPUT y se activa con LOW (0 Volt = Tierra)
  pinMode(PIN_RELE_EXTERNO, OUTPUT);
  digitalWrite(PIN_RELE_EXTERNO, LOW);

  // Relé Original (PIN 32): Se activa con HIGH (Sobre 3.3V)
  digitalWrite(PIN_RELE_ORIGINAL, HIGH);

  isAlarmActive = true;
  alarmStartTime = millis();
  lastActionTime = millis();

  // Indicador visual: LED Azul encendido fijo durante alarma
  digitalWrite(PIN_LED_AZUL, HIGH);

  Serial.println("🔴 ALARMA ACTIVADA: Relé Externo (PIN26=LOW) + Relé Original (PIN32=HIGH)");
}

// ============================================================
// FUNCION: Detener Sirena (Apagar Relés)
// ============================================================
void apagarAlarma() {
  if (isAlarmActive) {
    Serial.println("🛑 DESACTIVANDO ALARMA");
  }
  isAlarmActive = false;

  // Apagar Relé Externo asegurando HIGH en lugar de Alta Impedancia
  pinMode(PIN_RELE_EXTERNO, OUTPUT);
  digitalWrite(PIN_RELE_EXTERNO, HIGH);

  digitalWrite(PIN_RELE_ORIGINAL, LOW); // LOW desactiva el relé original
  digitalWrite(PIN_BUZZER, LOW);

  lastActionTime = millis();

  // LED Azul vuelve a su estado normal (encendido si hay WiFi)
  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(PIN_LED_AZUL, HIGH);
  } else {
    digitalWrite(PIN_LED_AZUL, LOW);
  }

  Serial.println("🟢 ALARMA DESACTIVADA: Relé Externo (PIN26=HIGH-Z) + Relé Original (PIN32=LOW)");
}

// ============================================================
// ENDPOINT WEB: /activar → Encender alarma desde el Backend (Guardián validó)
// ============================================================
void manejarActivarWeb() {
  Serial.println("🌐 ORDEN DEL BACKEND VALIDADA: ¡Activar Alarma!");
  encenderAlarma();
  server.send(200, "text/plain", "Alarma Activada");
}

// ============================================================
// ENDPOINT WEB: /silenciar → Apagar alarma desde el Backend o App
// ============================================================
void manejarSilencioWeb() {
  Serial.println("🌐 ORDEN DEL BACKEND VALIDADA: ¡Silenciar Alarma!");
  apagarAlarma();
  server.send(200, "text/plain", "Alarma Silenciada");
}

// ============================================================
// ENDPOINT WEB: /identificar → Parpadeo corto del Relé/Buzzer (sin bloquear backend)
// ============================================================
void manejarIdentificar() {
  Serial.println("🌐 ORDEN DEL BACKEND: ¡Identificar Placa!");

  // Flash rápido del estrobo y buzzer 3 veces
  for (int i = 0; i < 3; i++) {
    pinMode(PIN_RELE_EXTERNO, OUTPUT);
    digitalWrite(PIN_RELE_EXTERNO, LOW); // Activar
    digitalWrite(PIN_BUZZER, HIGH);
    delay(150);

    digitalWrite(PIN_RELE_EXTERNO, HIGH); // Desactivar firmemente enviando 3.3v
    digitalWrite(PIN_BUZZER, LOW);
    delay(150);
  }

  // Asegurar estado correcto post-identificación
  if (!isAlarmActive) {
    apagarAlarma();
  }

  server.send(200, "text/plain", "Placa Identificada");
}

// ============================================================
// ENDPOINT WEB: /toggle → El backend llama esto tras validar el RF
// Si la alarma está off → la enciende. Si está on → la apaga.
// ============================================================
void manejarToggleWeb() {
  if (isAlarmActive) {
    Serial.println("🌐 TOGGLE del Backend: Apagando alarma activa.");
    apagarAlarma();
    server.send(200, "text/plain", "Alarma Apagada via Toggle");
  } else {
    Serial.println("🌐 TOGGLE del Backend: Encendiendo alarma.");
    encenderAlarma();
    server.send(200, "text/plain", "Alarma Encendida via Toggle");
  }
}

// ============================================================
// ENDPOINT WEB: /status → Verificar estado actual del ESP
// ============================================================
void manejarStatus() {
  String estado = isAlarmActive ? "activa" : "inactiva";
  String json = "{\"alarm\":\"" + estado + "\",\"wifi\":\"" + String(WiFi.RSSI()) + " dBm\",\"ip\":\"" + WiFi.localIP().toString() + "\",\"mac\":\"" + WiFi.macAddress() + "\"}";
  server.send(200, "application/json", json);
}

// ============================================================
// FUNCIÓN: Sincronizar Whitelist de códigos RF desde el Backend
// ============================================================
void sincronizarWhitelist() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String mac = WiFi.macAddress();
  String whitelistUrl = "http://" + backendIP + ":3001/api/esp/authorized-codes/" + mac;

  http.begin(whitelistUrl);
  int httpCode = http.GET();

  if (httpCode == 200) {
    String body = http.getString();
    // Parsear JSON manualmente (sin librería extra)
    authorizedCount = 0;
    int codesStart = body.indexOf('[');
    int codesEnd   = body.indexOf(']');
    if (codesStart != -1 && codesEnd != -1) {
      String codesArray = body.substring(codesStart + 1, codesEnd);
      int idx = 0;
      while (codesArray.length() > 0 && authorizedCount < MAX_AUTHORIZED_CODES) {
        // Buscar la próxima comilla de apertura
        int q1 = codesArray.indexOf('"');
        if (q1 == -1) break;
        int q2 = codesArray.indexOf('"', q1 + 1);
        if (q2 == -1) break;
        authorizedCodes[authorizedCount++] = codesArray.substring(q1 + 1, q2);
        codesArray = codesArray.substring(q2 + 1);
      }
    }
    // Guardar en NVS para persistencia offline
    preferences.begin("whitelist", false);
    preferences.putInt("count", authorizedCount);
    for (int i = 0; i < authorizedCount; i++) {
      preferences.putString(("code" + String(i)).c_str(), authorizedCodes[i]);
    }
    preferences.end();
    Serial.println("✅ Whitelist RF sincronizada. Códigos autorizados: " + String(authorizedCount));
  } else {
    Serial.println("⚠️ Whitelist no pudo sincronizarse. Usando datos guardados en NVS.");
    // Cargar desde NVS si hay datos guardados
    preferences.begin("whitelist", true);
    authorizedCount = preferences.getInt("count", 0);
    for (int i = 0; i < authorizedCount; i++) {
      authorizedCodes[i] = preferences.getString(("code" + String(i)).c_str(), "");
    }
    preferences.end();
  }
  http.end();
  lastSyncTime = millis();
}

bool isCodeAuthorized(String rfCode) {
  for (int i = 0; i < authorizedCount; i++) {
    if (authorizedCodes[i] == rfCode) return true;
  }
  return false;
}

// ============================================================
// FUNCIÓN: Registrar IP del ESP en el Backend de Node.js
// ============================================================
void registrarEnBackend() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(registerUrl);
    http.addHeader("Content-Type", "application/json");

    String mac = WiFi.macAddress();
    String ip = WiFi.localIP().toString();
    String jsonPayload = "{\"macAddress\": \"" + mac + "\", \"ip\": \"" + ip + "\"}";

    Serial.println("📡 Registrando ESP en Backend: " + String(registerUrl));
    Serial.println("   MAC: " + mac + " | IP: " + ip);

    int httpResponseCode = http.POST(jsonPayload);

    if (httpResponseCode > 0) {
      Serial.print("   Respuesta del Backend: ");
      Serial.println(httpResponseCode);
      if (httpResponseCode == 200) {
        Serial.println("   ✅ ESP registrado exitosamente en el servidor central.");
      }
    } else {
      Serial.print("   ⚠️ No se pudo registrar (Backend apagado?): ");
      Serial.println(httpResponseCode);
    }
    http.end();
  }
}

// ============================================================
// FUNCIÓN: Reset WiFi al presionar el MicroSwitch (PIN 13)
// ============================================================
void verificarBotonWiFi() {
  if (millis() - lastWifiCheckTime < WIFI_CHECK_INTERVAL) return;
  lastWifiCheckTime = millis();

  // PIN 13 tiene 5V permanente. El switch inyecta 0V (LOW) al presionar.
  if (digitalRead(PIN_BOTON_WIFI) == LOW) {
    Serial.println("🔄 BOTÓN WiFi PRESIONADO: Borrando credenciales y reiniciando...");

    // Indicar visualmente con parpadeo rápido del buzzer y LED
    for (int i = 0; i < 5; i++) {
      digitalWrite(PIN_BUZZER, HIGH);
      digitalWrite(PIN_LED_AZUL, LOW);
      delay(100);
      digitalWrite(PIN_BUZZER, LOW);
      digitalWrite(PIN_LED_AZUL, HIGH);
      delay(100);
    }

    WiFiManager wifiManager;
    wifiManager.resetSettings(); // Borra las credenciales guardadas en la memoria

    // Borrar también la IP del backend guardada
    preferences.begin("config", false);
    preferences.remove("backendIP");
    preferences.end();

    Serial.println("✅ Memoria WiFi y configuración borradas. Reiniciando en modo Portal Cautivo...");
    delay(1000);
    ESP.restart(); // Reinicia la placa para levantar la red "Alarma_Configurar"
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Configurar pines de SALIDA
  pinMode(PIN_RELE_ORIGINAL, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_AZUL, OUTPUT);

  // Configurar pin de ENTRADA (MicroSwitch WiFi Reset)
  // Usa INPUT_PULLUP: El pin tiene 5V externo permanente, pero el pullup interno
  // ayuda a estabilizar la lectura cuando el switch no está presionado.
  pinMode(PIN_BOTON_WIFI, INPUT_PULLUP);

  // ¡APAGADO TOTAL INMEDIATO AL ENCENDER!
  // Relé Externo (PIN 26): Activo LOW. Para asegurar que esté apagado por defecto y no flote en 1.3v,
  // lo configuramos como OUTPUT y lo enviamos firmemente a HIGH (3.3V).
  pinMode(PIN_RELE_EXTERNO, OUTPUT);
  digitalWrite(PIN_RELE_EXTERNO, HIGH);

  // Relé Original (PIN 32): HIGH = activado, LOW = desactivado
  digitalWrite(PIN_RELE_ORIGINAL, LOW);
  // Buzzer apagado
  digitalWrite(PIN_BUZZER, LOW);
  // LED Azul apagado hasta tener WiFi
  digitalWrite(PIN_LED_AZUL, LOW);

  Serial.println("\n\n************************************");
  Serial.println("  SISTEMA ESTABILIZADO - INICIANDO");
  Serial.println("  Pines según documentación oficial");
  Serial.println("************************************\n");

  Serial.println("⏳ Esperando 5s para estabilizar señales eléctricas...");
  delay(5000); // Ventana de seguridad anti-falsas alarmas al boot

  // ===== CONFIGURACION DEL RECEPTOR CC1101 (SPI) =====
  Serial.println("📡 Inicializando Radio CC1101 por SPI...");
  if (ELECHOUSE_cc1101.getCC1101()) {
    Serial.println("   ✅ CC1101 Detectado perfectamente.");
  } else {
    Serial.println("   ❌ ERROR: CC1101 no encontrado. (Revisa cableado MISO/MOSI/SCK/CSN)");
  }

  ELECHOUSE_cc1101.setGDO(PIN_ANTENA, 4);  // GDO0 = Pin 2, GDO2 = Pin 4 (No usado)
  ELECHOUSE_cc1101.Init();            // Inicializar el chip CC1101
  ELECHOUSE_cc1101.setMHZ(433.92);    // Frecuencia estándar para alarmas

  // Opciones Vitales para Llaveros Estándar y Anti-Interferencia:
  ELECHOUSE_cc1101.setModulation(2);  // 2 = ASK/OOK, Obligatorio para llaveros
  ELECHOUSE_cc1101.setMHZ(433.92);    // Frecuencia central estándar.

  // OPTIMIZACIÓN RECEPCIÓN:
  // Quitamos la "súper sensibilidad" y DRate de 512 que agregamos para la prueba
  // porque el filtro digital estaba "comiendo" pulsos o abriéndose a mucho ruido.
  ELECHOUSE_cc1101.setRxBW(325);      // Filtro moderado (balance perfecto entre alcance y ruido)
  ELECHOUSE_cc1101.SetRx();           // Iniciar modo Escucha Activa

  delay(100);

  // Habilitar la lectura RCSwitch sobre el pin recibidor
  mySwitch.enableReceive(digitalPinToInterrupt(PIN_ANTENA));
  Serial.println("   ✅ Radio lista. Parámetros RF optimizados para largo alcance.");
  // ====================================================

  Serial.println("🌐 Iniciando Gestor de WiFi...");
  WiFiManager wifiManager;

  // Cargar IP del backend guardada (si existe)
  preferences.begin("config", false);
  backendIP = preferences.getString("backendIP", "192.168.100.111");

  // Añadir parámetro personalizado al portal de WiFiManager
  WiFiManagerParameter custom_backend_ip("server", "IP del Backend (Ej: 192.168.100.111)", backendIP.c_str(), 40);
  wifiManager.addParameter(&custom_backend_ip);

  // Si no encuentra redes guardadas o no puede conectar, levanta la red "Alarma_Configurar"
  if (!wifiManager.autoConnect("Alarma_Configurar")) {
    Serial.println("❌ Fallo al conectar o se agotó el tiempo. Reiniciando...");
    delay(3000);
    ESP.restart();
  }

  // Verificar si la IP del backend fue cambiada en el portal cautivo
  String newIP = custom_backend_ip.getValue();
  if (newIP != backendIP) {
    backendIP = newIP;
    preferences.putString("backendIP", backendIP);
    Serial.println("💾 Nueva IP del backend guardada: " + backendIP);
  }
  preferences.end();

  // Construir URLs dinámicamente
  serverUrl = "http://" + backendIP + ":3001/api/alarm";
  registerUrl = "http://" + backendIP + ":3001/api/esp/register";

  // Codificar Basic Auth para snapshot de cámara
  // Codificar Basic Auth para snapshot de cámara
  snapshotAuth = base64Encode(camUser + ":" + camPass);

  // ¡Conectado con éxito! -> Luz Azul Fija (per documentación)
  digitalWrite(PIN_LED_AZUL, HIGH);

  // Pitido rápido de victoria anunciando conexión
  digitalWrite(PIN_BUZZER, HIGH);
  delay(150);
  digitalWrite(PIN_BUZZER, LOW);

  Serial.println("\n¡Wifi Abierto y Conectado!");
  Serial.print("--> COPIA TU DIRECCIÓN MAC PARA EL BACKEND: ");
  Serial.println(WiFi.macAddress());
  Serial.print("--> IP LOCAL DEL ESP: ");
  Serial.println(WiFi.localIP());
  Serial.print("--> IP DEL BACKEND CONFIGURADA: ");
  Serial.println(backendIP);

  // Preparar WebServer con endpoints de control remoto
  server.on("/activar", manejarActivarWeb);
  server.on("/silenciar", manejarSilencioWeb);
  server.on("/identificar", manejarIdentificar);
  server.on("/toggle", manejarToggleWeb);
  server.on("/status", manejarStatus);
  server.begin();
  Serial.println("🌐 Servidor Web del ESP32 Listo (Endpoints: /activar, /silenciar, /identificar, /toggle, /status)");

  // Registrar esta placa en el Backend de Node.js
  registrarEnBackend();

  // Sincronizar la whitelist de códigos autorizados
  sincronizarWhitelist();
}

void loop() {
  // Atender Peticiones HTTP de NodeJS (Capa Web)
  server.handleClient();

  // Verificar si alguien presionó el botón de reset WiFi (PIN 13)
  verificarBotonWiFi();

  // Sincronización periódica de whitelist + re-registro (cada 5 min)
  if (WiFi.status() == WL_CONNECTED && (millis() - lastSyncTime > SYNC_INTERVAL_MS)) {
    sincronizarWhitelist();
    registrarEnBackend(); // Re-registrar IP por si el servidor se reinició
  }

  // Long polling de comandos desde la nube (conexión persistente, respuesta instantánea)
  if (WiFi.status() == WL_CONNECTED && !pollingActive) {
    consultarComandosPendientes();
  }

  // Subir snapshots de cámara local al droplet (cada 2 segundos)
  capturarYSubirSnapshot();

  // Capa de Auto-Silencio (Seguro Vecinal 3 Minutos)
  if (isAlarmActive && (millis() - alarmStartTime > ALARM_TIMEOUT_MS)) {
    Serial.println("⏰ Auto-Silencio de 3 minutos activado. Restableciendo paz...");
    apagarAlarma();
  }

  // Monitorear señales del receptor RF 433 MHz
  if (mySwitch.available()) {
    // CAPA DE SEGURIDAD: Ignoramos ruido eléctrico por 1 segundo tras la última acción
    if (millis() - lastActionTime < LOCKOUT_MS) {
      mySwitch.resetAvailable();
      return;
    }

    long value = mySwitch.getReceivedValue();

    if (value == 0) {
      Serial.println("Señal incompresible detectada (ruido o interferencia).");
    } else {
      lastActionTime = millis(); // Marcar tiempo de interacción

      Serial.print("\n>>> SEÑAL RF DETECTADA. Código: ");
      Serial.println(value);
      Serial.println("   Enviando al Servidor Guardián para validación...");

      // 🔐 SEGURIDAD: La placa NO decide por su cuenta.
      // Solo reporta el código al Backend. El servidor verifica los 3 Guardianes
      // y si todo es válido, llamará de vuelta a /toggle para activar/desactivar.
      sendAlarm(String(value));
    }
    mySwitch.resetAvailable();
  }

  // Monitoreo de conexión WiFi: Si se pierde, parpadear LED y Buzzer
  if (WiFi.status() != WL_CONNECTED) {
    // LED Azul intermitente cuando no hay WiFi (per documentación)
    static unsigned long lastBlink = 0;
    if (millis() - lastBlink > 500) {
      lastBlink = millis();
      digitalWrite(PIN_LED_AZUL, !digitalRead(PIN_LED_AZUL));
      // Buzzer intermitente cuando sin internet (per documentación)
      digitalWrite(PIN_BUZZER, !digitalRead(PIN_BUZZER));
    }
  }
}

void sendAlarm(String rfCode) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    String mac = WiFi.macAddress();
    String ip = WiFi.localIP().toString();
    String accion = isAlarmActive ? "Silenciar" : "Robo";
    String jsonPayload = "{\"macAddress\": \"" + mac + "\", \"rfCode\": \"" + rfCode + "\", \"type\": \"" + accion + "\", \"ip\": \"" + ip + "\"}";

    Serial.println("   Enviando código RF al Guardián: " + String(serverUrl));
    int httpResponseCode = http.POST(jsonPayload);

    if (httpResponseCode > 0) {
      Serial.print("   Veredicto del Servidor Guardián (HTTP): ");
      Serial.println(httpResponseCode);

      if (httpResponseCode == 200) {
        String payload = http.getString();
        Serial.println("   ✅ Control VALIDADO por el servidor.");
        if (payload.indexOf("\"action\":\"toggle\"") > 0 || payload.indexOf("\"action\": \"toggle\"") > 0) {
          if (isAlarmActive) apagarAlarma();
          else encenderAlarma();
        }
      } else if (httpResponseCode == 403) {
        Serial.println("   🚫 Control RECHAZADO: MAC o Sector no autorizados.");
      } else if (httpResponseCode == 404) {
        Serial.println("   🚫 Control RECHAZADO: Código RF no registrado en la base de datos.");
      }
    } else {
      // Backend no responde → usar whitelist local
      Serial.println("   ⚠️ Sin respuesta del backend. Verificando whitelist local...");
      if (isCodeAuthorized(rfCode)) {
        Serial.println("   ✅ Código encontrado en whitelist offline. Activando modo de emergencia.");
        // Pitido triple: aviso de modo offline
        for (int i = 0; i < 3; i++) {
          digitalWrite(PIN_BUZZER, HIGH); delay(100);
          digitalWrite(PIN_BUZZER, LOW);  delay(100);
        }
        if (isAlarmActive) apagarAlarma();
        else encenderAlarma();
      } else {
        Serial.println("   🚫 Código desconocido en modo offline. Ignorando por seguridad.");
      }
    }
    http.end();
  } else {
    // Sin WiFi: verificar whitelist local antes de actuar
    Serial.println("⚠️ Sin WiFi. Verificando whitelist offline...");
    if (isCodeAuthorized(rfCode)) {
      Serial.println("✅ Código autorizado offline. Activando alarma.");
      for (int i = 0; i < 3; i++) {
        digitalWrite(PIN_BUZZER, HIGH); delay(100);
        digitalWrite(PIN_BUZZER, LOW);  delay(100);
      }
      if (isAlarmActive) apagarAlarma();
      else encenderAlarma();
    } else {
      Serial.println("🚫 Código desconocido. No se activa en modo offline sin autorización previa.");
    }
  }
}
