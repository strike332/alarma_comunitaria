/*
  DIAGNOSTICO v6 - SNIFFER DE PINES
  
  Estrategia: Poner TODOS los pines como INPUT y monitorear
  cuáles cambian cuando se activa la alarma con el control remoto.
  
  Instrucciones:
  1. Sube este código
  2. Abre Monitor Serial (115200)
  3. Escribe 'go' para empezar a monitorear
  4. Presiona el botón del control remoto
  5. La consola mostrará qué pines reaccionaron
*/

#include <RCSwitch.h>
RCSwitch mySwitch = RCSwitch();

// TODOS los GPIO posibles del ESP32 (excepto 0,1,3 que son boot/serial)
const int PINES[] = {2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39};
const int NUM_PINES = 23;

// Estado anterior de cada pin
int estadoAnterior[23];
bool monitoring = false;
unsigned long lastPrint = 0;

void setup() {
  Serial.begin(115200);
  delay(500);
  
  // Configurar TODOS los pines como INPUT
  for (int i = 0; i < NUM_PINES; i++) {
    pinMode(PINES[i], INPUT);
    estadoAnterior[i] = digitalRead(PINES[i]);
  }
  
  Serial.println("\n==========================================");
  Serial.println("  DIAGNOSTICO v6 - SNIFFER DE PINES");
  Serial.println("==========================================");
  Serial.println("Todos los pines estan en modo ESCUCHA.");
  Serial.println("");
  Serial.println("Escribe 'go' y luego presiona el control");
  Serial.println("remoto. Vere que pines reaccionan.");
  Serial.println("==========================================");
}

void loop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    
    if (cmd == "go") {
      monitoring = true;
      // Habilitar RF
      mySwitch.enableReceive(digitalPinToInterrupt(2));
      
      // Guardar estado inicial de todos los pines
      Serial.println("\n--- ESTADO INICIAL DE TODOS LOS PINES ---");
      for (int i = 0; i < NUM_PINES; i++) {
        estadoAnterior[i] = digitalRead(PINES[i]);
        Serial.print("  GPIO ");
        if (PINES[i] < 10) Serial.print(" ");
        Serial.print(PINES[i]);
        Serial.print(": ");
        Serial.println(estadoAnterior[i] == HIGH ? "HIGH" : "LOW");
      }
      Serial.println("-----------------------------------------");
      Serial.println("MONITOREANDO... Presiona el control ahora!");
      Serial.println("Cualquier cambio aparecera aqui abajo:");
      Serial.println("");
    }
    
    if (cmd == "stop") {
      monitoring = false;
      mySwitch.disableReceive();
      Serial.println("Monitoreo detenido.");
    }
  }
  
  if (!monitoring) return;
  
  // Revisar RF
  if (mySwitch.available()) {
    long value = mySwitch.getReceivedValue();
    Serial.print("\n>>> SENAL RF RECIBIDA! Codigo: ");
    Serial.println(value);
    mySwitch.resetAvailable();
  }
  
  // Revisar TODOS los pines por cambios
  for (int i = 0; i < NUM_PINES; i++) {
    int estadoActual = digitalRead(PINES[i]);
    
    if (estadoActual != estadoAnterior[i]) {
      Serial.print("*** CAMBIO -> GPIO ");
      Serial.print(PINES[i]);
      Serial.print(": ");
      Serial.print(estadoAnterior[i] == HIGH ? "HIGH" : "LOW");
      Serial.print(" -> ");
      Serial.print(estadoActual == HIGH ? "HIGH" : "LOW");
      Serial.print("  (millis: ");
      Serial.print(millis());
      Serial.println(") ***");
      
      estadoAnterior[i] = estadoActual;
    }
  }
}
