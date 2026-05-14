# REINGENIERÍA MapFiber → Estilo TOMODAT

Basado en análisis profundo de TOMODAT v2.17.27 (mia4.tomodat.com)

## LAYOUT TOMODAT (estructura exacta)

```
┌─────────────────────────────────────────────────────────┐
│  LOGO  │  Proyecto │ Comercial │ Monitor │ Ajustes │ ⚙️ │  ← TOP-BAR
├──────────┼──────────────────────────────────────────────┤
│                                            │
│  🔍 Buscar...   [filtros]                  │
│  ☐ Proyecto 1                              │
│  └── ☐ Zona Norte                          │
│  │    ├── ☐ OLT Central                    │  ← GOOGLE MAPS
│  │    ├── ☐ Manga Principal                │    (ocupa el centro)
│  │    └── ☐ NAP Residencial A              │
│  └── ☐ Zona Sur                            │
│       ├── ☐ OLT-2                         │
│       └── ☐ Manga-2                       │
│                                            │
│  ← JSTREE SIDEBAR                          │
│    (~300px)                                │
│                                            │
└─────────────────────────────────────────────────────────┘

Modal AP Visualizer (al hacer clic en un AP/manga):
┌──────────────────────────────────────────────────────┐
│  🧶 Manga Principal  [✕]                            │
│  ┌────────────────────────────────────────────────┐  │
│  │  CABLES IN  │  🔗 EMPALMES  │  CABLES OUT      │  │
│  │  ┌──────┐   │  ╱╲  ╱╲  ╱╲   │  ┌──────┐        │  │
│  │  │#1●───│───│──●──●──●──│───│───●#1│        │  │  ← SVG
│  │  │#2●───│───│──●──●──●──│───│───●#2│        │  │    D3.js
│  │  └──────┘   │  loss:0.5  │  └──────┘        │  │    animado
│  │             │  ⚡ -18dBm  │                  │  │
│  │  SPLITTER:  │  1:16      │                  │  │
│  └────────────────────────────────────────────────┘  │
│  📋 Panel lateral: lista de fibras, clientes, poder  │
└──────────────────────────────────────────────────────┘
```

## ESQUEMA DE COLORES TOMODAT
- Fondo general: #f5f5f5 (gris claro) 
- Sidebar: #2d323e (gris oscuro)
- Topbar: #3a3f4b
- Acento principal: #2196F3 (azul)
- Acento secundario: #4CAF50 (verde)
- Peligro: #f44336 (rojo)
- Texto sidebar: #e0e0e0
- Texto principal: #333

## PALETA DE ICONOS TOMODAT
- SVG icons en `/tomodat/img/icons_menu/`
- Colores planos, estilo "material design"
- Iconos para: OLT, ONU, cable, splitter, etc.

## PLAN DE IMPLEMENTACIÓN

### FASE 1 — Layout base (ESTRUCTURA)
1. Reemplazar index.html con estructura TOMODAT
2. Nueva top-bar con tabs (Proyecto|Comercial|Monitor|Ajustes)
3. Reemplazar folder-tree con JSTree (jsTree plugin)
4. Mapa Leaflet pero con estilo oscuro TOMODAT
5. Panel AP Visualizer modal con SVG

### FASE 2 — Funcionalidades básicas
1. Login/página de empresa (como TOMODAT)
2. JSTree con checkboxes para visibilidad
3. Toolbar de acciones sobre el mapa (dibujar cable, medir, etc.)
4. Popups de elementos con acciones
5. AP Visualizer con fibras, splitters y fusiones

### FASE 3 — Funcionalidades avanzadas
1. SmartOLT / Dashboard ONU
2. Reportes (costo, clientes, items)
3. Integración ERP
4. Multi-idioma
