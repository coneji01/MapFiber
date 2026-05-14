# Diagrama ER — MapFiber V3

## Modelo de Mangas, Hilos y Splitters

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MANGA                                        │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────────┐    │
│  │ CABLE ENTRADA│   │  HILOS       │   │   SPLITTER           │    │
│  │             │   │  DENTRO      │   │                      │    │
│  │ Cable-A ├───────▶ Hilo#1 ──────▶ │ Entrada (puerto 0)     │    │
│  │ (12 hilos) │   │  (roto/cortado)│ │   ↓                   │    │
│  │             │   │              │   │ 1:8                  │    │
│  │             │   │  Hilo#2 ───────▶ │  ┌─┬─┬─┬─┬─┬─┬─┬─┐  │    │
│  │             │   │  (fusionado   │ │  │1│2│3│4│5│6│7│8│  │    │
│  │             │   │   splitter)   │ │  └─┴─┴─┴─┴─┴─┴─┴─┘  │    │
│  │             │   │              │   │   ↓   ↓          ↓       │
│  │             │   │  Hilo#3 ──────│   │ Cable-B  Cable-C ...    │
│  │             │   │  (pasante)──│──┼───▶▶▶ Cable-A_continua     │
│  │             │   │              │   │                      │    │
│  │             │   │  ⋮          │   └──────────────────────┘    │
│  │             │   │              │                               │
│  │             │   │  Hilo#12    │                               │
│  │             │   │  (pasante)──│────────────────────────────    │
│  └─────────────┘   └──────────────┘                              │
└─────────────────────────────────────────────────────────────────────┘
```

## 📐 Estructura de Tablas y Relaciones

### 1. `manga` — Cierre de empalme / NAP
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | PK | Identificador único |
| `name` | TEXT | Nombre |
| `lat`, `lng` | REAL | Coordenadas GPS |
| `tipo_manga` | TEXT | `empalme`, `splitter`, `mixta`, `nap` |
| `description` | TEXT | Descripción |

### 2. `cable` — Cable de fibra óptica
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | PK | Identificador único |
| `name` | TEXT | Nombre del cable |
| `fiber_count` | INT | Cantidad de hilos (12, 24, 48, 96...) |
| `length_m` | REAL | Longitud total en metros |
| `color` | TEXT | Color en el mapa |

### 3. `entrada_cable_manga` — ⭐ Pivote Manga ↔ Cable
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | PK | Identificador único |
| `manga_id` | FK→manga | Manga donde entra |
| `cable_id` | FK→cable | Cable que entra |
| `tipo` | TEXT | `atraviesa`, `termina_aqui`, `inicia_aqui` |
| `cable_continuacion_id` | FK→cable | Si atraviesa, por qué cable sigue |

**Relación:** `MANGA 1──N──ENTRADA_CABLE_MANGA N──1──CABLE`

### 4. `hilo_dentro_manga` — ⭐⭐ EL CORAZÓN DEL MODELO
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | PK | Identificador único |
| `entrada_cable_manga_id` | FK | A qué entrada de cable pertenece |
| `numero_hilo` | INT | Posición física (1-144) |
| `estado` | TEXT | **pasante**, **fusionado_fibra**, **fusionado_splitter**, **terminado**, **roto** |
| `fusionado_a_hilo_id` | FK→hilo_dentro_manga | Si está fusionado a otro hilo |
| `splitter_id` | FK→splitter | Si está conectado a splitter |
| `splitter_puerto` | INT | 0=entrada, 1-N=salida |
| `potencia_db` | REAL | Potencia óptica en dBm |
| `perdida_db` | REAL | Pérdida de la fusión |

**Estados posibles de un hilo dentro de la manga:**
```
                        ┌──────────┐
                        │  PASANTE │  ← No se toca, sigue intacto
                        └────┬─────┘
                             │
                  ┌──────────┼──────────┐
                  ▼          ▼          ▼
           ┌──────────┐ ┌──────────┐ ┌──────────┐
           │FUSIONADO │ │FUSIONADO │ │ TERMINADO│
           │  FIBRA   │ │ SPLITTER │ │          │
           └──────────┘ └──────────┘ └──────────┘
                                               
                  si se deshace...
                        ↓
                   ┌──────────┐
                   │   ROTO   │  ← Irreversible
                   └──────────┘
```

### 5. `splitter` — Splitter óptico dentro de manga
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | PK | Identificador único |
| `manga_id` | FK→manga | Manga que lo contiene |
| `tipo_split` | TEXT | `1:4`, `1:8`, `1:16`, `1:32`, `1:64` |
| `puertos` | INT | Cantidad de puertos de salida |
| `perdida_db` | REAL | Pérdida óptica del splitter |
| `hilo_entrada_id` | FK→hilo_dentro_manga | Hilo que alimenta el splitter |

### 6. `cable_tramo` — Segmento de cable entre mangas
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | PK | Identificador único |
| `cable_origen_id` | FK→cable | Cable físico original |
| `manga_inicio_id` | FK→manga | Manga donde empieza este tramo |
| `manga_fin_id` | FK→manga | Manga donde termina |
| `longitud_metros` | REAL | Distancia del tramo |
| `hilos_presentes` | TEXT | JSON array de hilos que siguen vivos |

### 7. `michelle_grupo` — Agrupación de sangrado
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | PK | Identificador único |
| `manga_id` | FK→manga | Manga donde se hizo el sangrado |
| `hilos_cortados` | INT | Cuántos hilos se cortaron |
| `hilos_pasantes` | INT | Cuántos quedaron intactos |

---

## 🔄 Flujo Lógico: Cable de 12 hilos con Splitter 1:8

```
Cable-A (12 hilos, 1000m, desde OLT)

    ↓
[MANGA-01 — km 0.5]
    │
    ├── Entra: Cable-A (12 hilos)
    │
    ├── Hilos dentro de la manga:
    │   ├── Hilo#1: fusionado_splitter → Splitter-01 (1:8), entrada
    │   ├── Hilo#2: fusionado_splitter → Splitter-01 (1:8), entrada
    │   ├── Hilo#3: pasante → sigue por Cable-A_cont
    │   ├── Hilo#4-#12: pasante → siguen por Cable-A_cont
    │
    ├── Splitter-01 (1:8):
    │   ├── Entrada: Hilo#1 + Hilo#2 (fusionados juntos, o dos splitters separados)
    │   ├── Salida 1 → Cable-B, Hilo#1 → NAP-01
    │   ├── Salida 2 → Cable-B, Hilo#2 → NAP-02
    │   ├── Salida 3 → Cable-C, Hilo#1 → NAP-03
    │   ├── ...
    │
    └── Salen:
        ├── Cable-A_cont (10 hilos, Hilos#3-#12 pasantes)
        ├── Cable-B (2 hilos, Hilos#1-#2, hacia NAPs)
        └── Cable-C (6 hilos, Hilos#1-#6, hacia más NAPs)

    ↓
Cable-A_cont continúa al siguiente destino...
```

## 📊 Resumen de Estados y Transiciones

```
CREAR HILO EN MANGA
  │
  ├── estado = "pasante"           (default — no se corta)
  │
  ├── FUSIONAR A OTRO HILO
  │     └── estado = "fusionado_fibra"
  │           ├── seguido por: fusionado_a_hilo_id (referencia)
  │
  ├── CONECTAR A SPLITTER
  │     └── estado = "fusionado_splitter"
  │           ├── splitter_id + splitter_puerto
  │
  ├── DEJAR SUELTO
  │     └── estado = "terminado"   (punta suelta sin fusionar)
  │
  └── DESHACER OPERACIÓN
        └── estado = "roto"        (NUNCA vuelve a intacto)
```
