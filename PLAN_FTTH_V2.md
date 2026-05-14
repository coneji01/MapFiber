# PLAN MAESTRO — MapFiber v2 🚀

## Objetivo
Implementar todas las funcionalidades de TOMODAT en nuestro MapFiber.

## Arquitectura
- **Backend**: Node.js + Express + SQLite (existente)
- **Frontend**: Vanilla JS + Leaflet (existente)
- **Nuevo**: Sistema de fibras internas, empalmes, colores

## Fases de Implementación

### FASE 1 — Modelo de Fibras en Cables ✅
- [x] Cable types con cantidad de fibras (8, 12, 24, 48, 96, 144)
- [x] Cada cable registra fibras individuales con colores TIA/EIA-598
- [x] Backend: tabla cable_fibers, endpoints CRUD
- [x] Frontend: panel de creación de cable con selector de tipo y fibras

### FASE 2 — Visualizador de Mangas con Fibras
- [ ] Mostrar cables que entran a una manga
- [ ] Cada fibra visible con su color y estado (usada/libre)
- [ ] Clic en fibra → opciones (conectar, empalmar)
- [ ] SVG estilo TOMODAT con slots de conexión

### FASE 3 — Sistema de Empalmes/Fusiones
- [ ] Tabla fusions (access_point_connection_id_in, fiber_in, access_point_connection_id_out, fiber_out, connection_type, loss_db)
- [ ] API para CRUD de empalmes
- [ ] UI para conectar fibra_in ↔ fibra_out dentro de mangas
- [ ] Editar pérdida (loss) por empalme

### FASE 4 — Código de Colores (TIA/EIA-598)
- [ ] Tabla color_codes con fibras/tubos
- [ ] Colores estándar: Azul, Naranja, Verde, Café, Pizarra, Blanco, Rojo, Negro, Amarillo, Violeta, Rosa, Aguamarina
- [ ] UI para asignar colores a fibras de cable
- [ ] Visualización de colores en SVG

### FASE 5 — Conexión Fibra → Splitter → Clientes
- [ ] Conectar fibra de cable a puerto de splitter en NAP
- [ ] Cada salida de splitter a fibra de drop/cliente
- [ ] Ruteo de fibra extremo a extremo (OLT → ... → Cliente)
- [ ] Reporte de ruta de fibra

### FASE 6 — Hosts/Equipos (OLTs, Routers)
- [ ] Modelo de hosts con puertos
- [ ] Conectar fibras a puertos de host
- [ ] Monitoreo de potencia

### FASE 7 — Mejoras UI/UX
- [ ] Árbol de navegación estilo TOMODAT (jstree)
- [ ] Menú contextual mejorado
- [ ] Filtros por proyecto/carpeta
- [ ] Búsqueda de elementos

## Prioridades (según Joel)
1. ✅ Fibras internas en cables (ya en progreso)
2. Visualizador de mangas con fibras
3. Empalmes/fusiones
4. Colores TIA/EIA-598
5. Splitter → Cliente
