# PLAN DE IMPLEMENTACIÓN — Mejoras MapFiber vs TOMODAT

Basado en el análisis completo de TOMODAT v2.17.37 y del código actual de MapFiber.

## ESTADO ACTUAL DEL PROYECTO

El proyecto ya implementa ~80% de las funcionalidades de TOMODAT:

### ✅ Ya implementado
- Mapa Leaflet con OLTs, NAPs, Mangas, Cables
- Sistema de carpetas tipo Windows Explorer con drag & drop
- CRUD completo de OLTs, NAPs, Mangas, Cables
- Visualizador SVG de mangas (bloques izquierda/derecha, fibras coloreadas TIA/EIA-598)
- Visualizador SVG de NAPs con splitters
- Sistema de fusiones/empalmes con curvas Bézier y badges dB
- Splitters 1x2 a 1x64
- Fibras individuales por cable con colores y estados
- Conexión fibra → splitter → cliente
- Cálculo de atenuación y potencia
- Rutas de fibra extremo a extremo
- Tipos de cable estandarizados
- Códigos de color
- Reporte de red
- Acceso a mangas/NAPs desde popups del mapa

### 🎯 Prioridad 1 — Animación D3.js de flujo de datos (TOMODAT style)
- **Analyst:** Diseñar sistema de animación SVG con D3.js
- **dev-frontend:** Implementar animación de pulsos en fibras activas
- **dev-backend:** Endpoint para estado de potencia en tiempo real

### 🎯 Prioridad 2 — Power Monitoring OLT → Cliente
- **Analyst:** Diseñar interfaz de monitoreo de potencia
- **dev-frontend:** Mostrar potencia en badges del SVG con colores (verde/amarillo/rojo)
- **dev-backend:** Cálculo de potencia en toda la ruta

### 🎯 Prioridad 3 — Highlight de ruta de fibra (hover tracing)
- **Analyst:** Flujo de interacción
- **dev-frontend:** Al hacer hover sobre una fibra, resaltar toda su ruta a través de fusiones
- **dev-backend:** Endpoint de ruta completa de fibra

### 🎯 Prioridad 4 — Sistema de ONUs (client equipment)
- **Analyst:** Modelo de datos de ONU
- **dev-backend:** Tabla ONUs, CRUD, relación con cliente
- **dev-frontend:** Panel de ONU en visualizador

### 🎯 Prioridad 5 — Reportes PDF
- **Analyst:** Diseño de reportes
- **dev-frontend:** Generar PDF con jsPDF (como TOMODAT)
- **dev-backend:** Endpoints de datos para reportes

## ASIGNACIÓN POR AGENTE

| Agente | Rol | Responsabilidad |
|--------|-----|-----------------|
| **analyst** 🧠 | System Analyst | Especificaciones técnicas detalladas de cada mejora |
| **dev-frontend** 💻 | Frontend | SVG/D3.js visualizer, animaciones, UI panels |
| **dev-backend** ⚙️ | Backend | APIs endpoints, DB schema, cálculos |
| **dev-infra** ☁️ | DevOps | Docker, deployment, estructura del proyecto |
| **main** 🔧 | Coordinador | Orquestación, revisión, QA |

## ORDEN DE IMPLEMENTACIÓN

1. **Analyst** produce specs → todos trabajan en paralelo
2. **dev-backend** prepara APIs → **dev-frontend** consume
3. **dev-infra** asegura que todo corra
4. **main** revisa y coordina
